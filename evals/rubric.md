# Eval rubric — v0.1

Run the curator on `evals/golden-set.json` after every change to the spec or prompt. Save each run in `evals/runs/<date>-<short-name>.json` with a note on what changed.

## Metrics

| Metric | How to score | Target |
|---|---|---|
| Agreement | Share of candidates where the model's include/exclude matches your label | ≥ 85% |
| Wrong inclusions | Count of videos the model included that you labeled exclude | 0 (this is the costly error) |
| Wrong exclusions | Count of videos the model excluded that you labeled include | Track it, but it's tolerable |
| Blurb accuracy | Every claim in a blurb is supported by the title or description. Score pass/fail per blurb. | 100% |
| Blurb style | Passes the style rules in the spec (length, no hype, no "you'll love") | ≥ 90% |

## Building the golden set
- About 30 candidates. Mix clear includes, clear excludes and hard cases (a reaction video on a topic you love, a sponsored build, a 10-minute recap).
- Label each one yourself before running any model, with a one-line reason. The reasons are the spec in practice.
- Add a case every time feedback shows the curator got something wrong.
