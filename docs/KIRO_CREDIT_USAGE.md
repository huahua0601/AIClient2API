# Kiro credit usage

When the provider is `claude-kiro-oauth`, successful responses include an optional
`credits` extension in their usage object. It contains the sum of valid credit
metering events emitted by Kiro for that upstream response, without rounding.
It is independent of token estimates and is not a monetary amount in USD.

Example OpenAI Chat Completions usage (illustrative values):

```json
{
  "usage": {
    "prompt_tokens": 120,
    "completion_tokens": 24,
    "total_tokens": 144,
    "credits": 0.031122508789386404
  }
}
```

| Client protocol | Non-stream response | Stream response |
| --- | --- | --- |
| Anthropic Messages | `usage.credits` | Final `message_delta.usage.credits` |
| OpenAI Chat Completions | `usage.credits` | Final completion chunk's `usage.credits` |
| OpenAI Responses | `usage.credits` | `response.completed.response.usage.credits` |
| Gemini | `usageMetadata.credits` | Final chunk's `usageMetadata.credits` |

The field is absent until upstream metering is available; absence does not mean
zero cost. An explicit zero reported by Kiro is returned as `0`. A failed or
interrupted response may never produce final usage. This is the usage of the
returned response, not an account-wide total or a ledger of failed/retried
attempts. Account quota is queried separately via the provider quota endpoint.

This is an API extension. Clients or proxies that only retain standard token
fields must explicitly preserve `credits` to display or store it. It does not
automatically populate a client's dollar-cost field.
