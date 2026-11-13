import { jest } from '@jest/globals';
import { Readable } from 'node:stream';
jest.mock('open', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../src/utils/proxy-utils.js', () => ({
    configureAxiosProxy: jest.fn(), configureTLSSidecar: jest.fn(),
    isTLSSidecarEnabledForProvider: jest.fn(() => false)
}));

let KiroApiService, ClaudeConverter;
beforeAll(async () => {
    ({ KiroApiService } = await import('../src/providers/claude/claude-kiro.js'));
    ({ ClaudeConverter } = await import('../src/converters/strategies/ClaudeConverter.js'));
});

function frame(type, payload) {
    const header = (name, value) => {
        const n = Buffer.from(name), v = Buffer.from(value);
        const prefix = Buffer.alloc(1 + n.length + 3);
        prefix[0] = n.length; n.copy(prefix, 1);
        prefix[1 + n.length] = 7;
        prefix.writeUInt16BE(v.length, 2 + n.length);
        return Buffer.concat([prefix, v]);
    };
    const headers = Buffer.concat([header(':event-type', type), header(':message-type', 'event')]);
    const data = Buffer.from(JSON.stringify(payload));
    const prelude = Buffer.alloc(12);
    prelude.writeUInt32BE(16 + headers.length + data.length);
    prelude.writeUInt32BE(headers.length, 4);
    return Buffer.concat([prelude, headers, data, Buffer.alloc(4)]);
}
const credit = 0.031122508789386404;
const model = 'claude-sonnet-4-5';
const request = () => ({ messages: [{ role: 'user', content: 'hi' }] });
function service(data) {
    const svc = Object.create(KiroApiService.prototype);
    Object.assign(svc, {
        isInitialized: true, config: {}, baseUrl: 'https://example.test/generateAssistantResponse',
        _prepareAccessTokenForRequest: async () => {},
        buildCodewhispererRequest: async () => ({}),
        _applySidecar: () => {}, estimateInputTokens: () => 5, countTextTokens: () => 2,
        _requestWithBuilderEndpointRouting: jest.fn(async config => ({
            data: config.responseType === 'stream' ? Readable.from([data.subarray(0, 19), data.subarray(19)]) : data
        }))
    });
    return svc;
}
function responseFrames(events = [{ unit: 'credit', usage: credit }]) {
    return Buffer.concat([
        frame('assistantResponseEvent', { content: 'Hello' }),
        ...events.map(event => frame('meteringEvent', event))
    ]);
}
async function collect(stream) { const result = []; for await (const item of stream) result.push(item); return result; }

test('binary parser retains a split metering frame with full numeric precision', () => {
    const svc = service();
    const data = frame('meteringEvent', { unit: 'credit', usage: credit });
    for (let split = 1; split < data.length; split++) {
        const first = svc.parseAwsEventStreamBuffer(data.subarray(0, split));
        expect(first.events).toEqual([]);
        const second = svc.parseAwsEventStreamBuffer(Buffer.concat([first.remaining, data.subarray(split)]));
        expect(second.events).toEqual([{ type: 'metering', data: { credits: credit } }]);
        expect(second.remaining.length).toBe(0);
    }
});

test.each([0, credit])('non-stream and stream responses propagate credit %s end to end', async credits => {
    const svc = service(responseFrames([{ unit: 'credit', usage: credits }]));
    const unary = await svc.generateContent(model, request());
    expect(unary.usage.credits).toBe(credits);
    expect(unary.content[0].text).toBe('Hello');
    expect(svc._requestWithBuilderEndpointRouting.mock.calls[0][0].responseType).toBe('arraybuffer');
    const chunks = await collect(svc.generateContentStream(model, request()));
    expect(chunks.find(chunk => chunk.type === 'message_start').message.usage).not.toHaveProperty('credits');
    expect(chunks.find(chunk => chunk.type === 'message_delta').usage.credits).toBe(credits);
    expect(chunks.filter(chunk => chunk.usage?.credits !== undefined)).toHaveLength(1);

    const converter = new ClaudeConverter();
    expect(converter.toOpenAIResponse(unary, model).usage.credits).toBe(credits);
    expect(converter.toOpenAIResponsesResponse(unary, model).usage.credits).toBe(credits);
    expect(converter.toGeminiResponse(unary, model).usageMetadata.credits).toBe(credits);
    const chat = chunks.map(chunk => converter.toOpenAIStreamChunk(chunk, model)).filter(Boolean);
    expect(chat.find(chunk => chunk.usage?.credits !== undefined).usage.credits).toBe(credits);
    const responses = chunks.flatMap(chunk => converter.toOpenAIResponsesStreamChunk(chunk, model, 'metering-' + credits));
    expect(responses.find(chunk => chunk.type === 'response.completed').response.usage.credits).toBe(credits);
    const gemini = chunks.map(chunk => converter.toGeminiStreamChunk(chunk, model)).filter(Boolean);
    expect(gemini.find(chunk => chunk.usageMetadata?.credits !== undefined).usageMetadata.credits).toBe(credits);
});

test('multiple metering events add within one request without leaking into subsequent requests', async () => {
    const svc = service(responseFrames([{ unit: 'credit', usage: 0.125 }, { unit: 'credit', usage: 0.25 }]));
    expect((await svc.generateContent(model, request())).usage.credits).toBe(0.375);
    const stream = await collect(svc.generateContentStream(model, request()));
    expect(stream.find(c => c.type === 'message_delta').usage.credits).toBe(0.375);
    svc._requestWithBuilderEndpointRouting = async () => ({ data: responseFrames([]) });
    expect((await svc.generateContent(model, request())).usage).not.toHaveProperty('credits');
});

test.each([[], [{ unit: 'USD', usage: 1 }], [{ unit: 'credit', usage: -1 }],
    [{ unit: 'credit', usage: null }], [{ unit: 'credit', usage: '0.1' }]].map(events => [events]))('missing or invalid metering is omitted: %p', async events => {
    const svc = service(responseFrames(events));
    const unary = await svc.generateContent(model, request());
    expect(unary.usage).not.toHaveProperty('credits');
    const stream = await collect(svc.generateContentStream(model, request()));
    expect(stream.find(c => c.type === 'message_delta').usage).not.toHaveProperty('credits');
    const converter = new ClaudeConverter();
    expect(converter.toOpenAIResponse(unary, model).usage).not.toHaveProperty('credits');
    expect(converter.toOpenAIResponsesResponse(unary, model).usage).not.toHaveProperty('credits');
});

test('tool-only responses retain metering and tool-use stop reason', async () => {
    const data = Buffer.concat([
        frame('toolUseEvent', { name: 'lookup', toolUseId: 'tool-1', input: '{}', stop: true }),
        frame('meteringEvent', { unit: 'credit', usage: credit })
    ]);
    const svc = service(data);
    const unary = await svc.generateContent(model, request());
    expect(unary.stop_reason).toBe('tool_use');
    expect(unary.content[0].type).toBe('tool_use');
    expect(unary.usage.credits).toBe(credit);
    const chunks = await collect(svc.generateContentStream(model, request()));
    const final = chunks.find(c => c.type === 'message_delta');
    expect(final.delta.stop_reason).toBe('tool_use');
    expect(final.usage.credits).toBe(credit);
});

test('concurrent streams on one adapter keep usage isolated', async () => {
    const svc = service();
    svc.buildCodewhispererRequest = async messages => ({ expected: Number(messages[0].content) });
    svc._requestWithBuilderEndpointRouting = async config => ({
        data: Readable.from([responseFrames([{ unit: 'credit', usage: config.data.expected }])])
    });
    const streams = await Promise.all([0.125, 0.25].map(value => collect(svc.generateContentStream(model, {
        messages: [{ role: 'user', content: String(value) }]
    }))));
    expect(streams.map(chunks => chunks.find(c => c.type === 'message_delta').usage.credits)).toEqual([0.125, 0.25]);
});
