# BYGA AI — Adaptive Voting & Token Efficiency

## Purpose
BYGA now uses AI as a second-opinion classifier. Deterministic market and ICT calculations run first; AI calls are gated by evidence.

## Default routing
- Core: Google Gemini, Groq, OpenRouter
- Verifier: Hugging Face, Cohere, NVIDIA API Catalog
- Backup: Mistral AI, SambaNova Cloud, Vercel AI Gateway

## Flow
Market data -> deterministic ICT context -> setup score -> 3-provider core -> majority -> verifier only on conflict -> backup only after core failure.

Setup score is a routing gate, not a trading confidence score:
- HTF alignment +25
- M5 BOS +25
- M5 liquidity sweep +20
- M5 FVG +15
- M15/H1 FVG +10
- premium/discount +5
- M5/H1 bias agreement +5

Score below 40 skips AI. Valid setups start with up to 3 core calls. Conflicting votes can add up to 2 verifier calls. If all core calls fail, configured backups can be used.

## Token policy
- Keep the compact prompt as the canonical prompt.
- Do not send verbose reasoning requirements.
- Prefer deterministic summaries over repeated raw historical candles.
- Provider-specific reasoning/thinking blocks are not persisted as final answers.
- Gemini 2.5+ supports implicit context caching. Gemini 3.8 Flash has a 4,096-token minimum for implicit caching. Keep stable prefixes together if a future prompt is large; do not inflate a short prompt just to reach the cache threshold.

## Configuration
Optional environment variables:
AI_CORE_PROVIDERS=google-gemini,groq,openrouter
AI_VERIFIER_PROVIDERS=hugging-face,cohere,nvidia-api-catalog
AI_BACKUP_PROVIDERS=mistral-ai,sambanova-cloud,vercel-ai-gateway

These control routing order only. Provider API credentials remain separate.

## Dashboard/API metadata
Analysis responses now expose routing.gate, routing.setup_score, routing.reasons, routing.ai_calls, and routing.stages_used. The existing voting result remains compatible.

## Provider notes
Cohere Command A+ can return a content list containing thinking and text blocks. BYGA extracts only text. NVIDIA async responses can return HTTP 202 and require request-id polling.

## Operational target
Typical valid setup: 3 AI calls. Conflict: up to 5. Weak setup: 0. This is an adaptive budget, not a guarantee of lower billing because provider pricing, quotas and cache hits vary.