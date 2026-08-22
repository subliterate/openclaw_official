# Network Optimization Opportunities (Agents/Sub-Agents)

1. Reuse gateway connections instead of opening a new `GatewayClient` per `callGateway()` RPC.
2. Merge the two pre-spawn `sessions.patch` calls in `sessions_spawn` (model + thinking) into a single patch.
3. Reduce repeated `agent -> agent.wait -> chat.history` sequences by returning final assistant text from `agent.wait` (or equivalent final response path).
4. Eliminate duplicate subagent completion waits by using a single completion source (`agent.wait`/lifecycle) for both registry and announce flow.
5. Remove extra lookup/verification RPCs in sandboxed `sessions_send` paths (avoid redundant `sessions.resolve`/`sessions.list` checks where possible).
