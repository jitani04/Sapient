# Evaluation Harness

This directory contains the evaluation suite for Sapient's RAG pipeline. Two
evaluations run against the same biomedical benchmark dataset
([`rag-datasets/rag-mini-bioasq`](https://huggingface.co/datasets/rag-datasets/rag-mini-bioasq))
ingested into pgvector through the **production** retrieval path:

Dataset alternatives and the rationale for the current 100-row run are tracked
in [`DATASETS.md`](DATASETS.md).

| Eval                      | What it measures                                                                          | LLM judge required? | Runtime                |
|---------------------------|-------------------------------------------------------------------------------------------|---------------------|------------------------|
| `retrieval_eval.py`       | Pure retrieval quality: recall@k, precision@k, MRR                                        | No                  | ~2–3 min (100 questions) |
| `ragas_eval.py`           | End-to-end RAG quality: faithfulness, answer relevancy, context precision, context recall, factual correctness | Yes (OpenAI judge)  | budget-dependent (100 questions) |
| `tutoring_eval.py`        | Pedagogical helpfulness on TutorBench: scaffolding, engagement, misconception handling, depth, connections, grounding | Yes (OpenAI judge)  | budget-dependent (100 TutorBench rows) |

The retrieval eval is deterministic and cheap — run it after every retriever
or embedding change. The Ragas eval is more expensive and noisier (LLM-judged)
but captures generation behavior, not just retrieval.

## Setup (one-time)

```bash
pip install -r evals/requirements.txt
export EVAL_OPENAI_API_KEY=...
export EVAL_SAMPLE_SIZE=100
export EVAL_DISTRACTOR_PASSAGES=500
python -m evals.ingest_dataset
```

`ingest_dataset.py` creates a dedicated eval user (`ragas-eval@local`),
embeds all passages referenced by the first `EVAL_SAMPLE_SIZE` QA rows plus `EVAL_DISTRACTOR_PASSAGES` distractor
passages, and writes `evals/eval_corpus_map.json` mapping passage IDs to
material IDs. Re-running wipes prior eval data first. Total ingestion takes
longer as the sample grows because every selected passage is embedded through
the production embedding service.

## Retrieval evaluation

```bash
python -m evals.retrieval_eval
```

Outputs aggregate metrics to stdout and per-question scores to
`evals/retrieval_results.csv`.

### Metrics

- **`recall@k`** — fraction of relevant passages retrieved in the top *k*.
  Measures whether the retriever surfaces the right material.
- **`precision@k`** — fraction of the top *k* retrieved passages that are
  relevant. Measures retriever specificity.
- **`mrr`** — mean reciprocal rank of the first relevant passage. A single
  number that captures whether the right answer is ranked highly.

### Expected ranges

For rag-mini-bioasq with `text-embedding-004` and a moderate distractor set, healthy
retrieval looks like:

| Metric        | Healthy | Warning      |
|---------------|---------|--------------|
| `recall@1`    | ≥ 0.45  | < 0.30       |
| `recall@5`    | ≥ 0.70  | < 0.55       |
| `recall@10`   | ≥ 0.85  | < 0.70       |
| `mrr`         | ≥ 0.55  | < 0.40       |

A drop of >5 absolute points in `recall@5` between commits is a regression
worth investigating before merging.

## End-to-end (Ragas) evaluation

```bash
python -m evals.ragas_eval
```

Generates an answer per question using the production prompt builder
(`app.services.prompt_builder.build_responses_input`) and the production
`LLMService`, then judges the resulting `(question, contexts, answer,
ground_truth)` tuples with Ragas using OpenAI as the judge. Per-row scores are
written to `evals/ragas_results.csv`.

Generation is **paced** to stay under Gemini quotas
(`EVAL_GEN_MIN_INTERVAL_SEC` defaults to 20s). Generated answers are
checkpointed to `evals/ragas_answers_checkpoint.json` after every question;
re-running the script resumes from the checkpoint without re-paying for
prior generations.

#### Per-row judging

`ragas_eval.py` now generates/checkpoints answers and then delegates judging to
the per-row checkpoint judge:

```bash
python -m evals.ragas_judge_checkpoint
```

This reads the same `ragas_answers_checkpoint.json` and judges each row's
five metrics independently, persisting per-row scores to
`evals/ragas_scores_checkpoint.json` after every metric. A 429 or process
kill costs at most one row of progress; resume by re-running the same
command. The judge uses `EVAL_OPENAI_API_KEY` or `OPENAI_API_KEY`
(`OPENAI_TTS_API_KEY` is accepted for local convenience).

### Metrics (Ragas)

- **`faithfulness`** — fraction of the generated answer's claims that are
  supported by the retrieved context. Catches hallucination.
- **`answer_relevancy`** — semantic relevance of the answer to the question.
  Catches off-topic responses.
- **`context_precision`** — fraction of retrieved chunks that are actually
  relevant. Complements deterministic `precision@k` with an LLM judgment.
- **`context_recall`** — fraction of the ground-truth answer that is
  supported by the retrieved context.
- **`factual_correctness`** — how well the generated answer matches the
  reference answer. Complements faithfulness: an answer can be grounded in the
  retrieved context but still miss or distort the expected answer.

### Tradeoffs

LLM-judged metrics carry the variance inherent to LLM-as-judge methodology.
Treat individual scores as trends across a sample, not point estimates.
Run the deterministic retrieval eval first; reserve Ragas for changes that
plausibly affect generation (prompt changes, model swaps, tool-calling
behavior).

## Pedagogical helpfulness evaluation

```bash
python -m evals.tutoring_eval
```

Scores tutor responses on six pedagogical dimensions using an OpenAI judge
against [`ScaleAI/TutorBench`](https://huggingface.co/datasets/ScaleAI/TutorBench)
by default. Independent of the RAG benchmark — measures how the tutor TEACHES,
not what it retrieves. Outputs per-scenario scores to
`evals/tutoring_results.csv` with checkpoint resume in
`evals/tutoring_responses_checkpoint.json`.

### Dimensions

- **`scaffolding`** — does the tutor break the topic into steps or lead the student through reasoning, rather than dumping the full answer?
- **`engagement`** — does the response invite the student to think (probing question, "try this") rather than only deliver exposition?
- **`misconception`** — when the student's message contains a misconception, does the tutor catch and gently correct it? (Defaults to 5 if no misconception is present.)
- **`depth`** — is the level matched to the question? Not too shallow, not a textbook chapter dump.
- **`connections`** — does the response use analogies, prior topics, or the student's existing knowledge?
- **`grounding`** — when sources are available, are factual claims tied to the cited materials? (Defaults to 5 if no sources are in scope.)

### TutorBench rows

The default tutoring eval samples the first `EVAL_TUTORING_SAMPLE_SIZE`
text-only rows from TutorBench. Each row provides a subject, original problem,
student follow-up, and sample-specific rubrics. The evaluator maps those
rubrics into the OpenAI judge prompt and still reports the six shared
pedagogical dimensions so scores stay comparable across rows.

Multimodal TutorBench rows are skipped by default because the current tutor
eval harness sends text-only prompts. Set `EVAL_TUTORING_INCLUDE_MULTIMODAL=1`
to include them with an explicit instruction not to invent missing visual
details.

### Reading the scores

A 5/5 mean across dimensions is unrealistic — the rubric is intentionally
demanding. Useful targets for the current production prompt:

| Mean overall | Reading                                                  |
|--------------|----------------------------------------------------------|
| ≥ 4.0        | Strong tutor behavior; safe baseline to compare against  |
| 3.5–4.0      | Functional; some categories likely below 3.5             |
| < 3.5        | Investigate which dimension(s) are pulling the mean down |

Per-category breakdown matters more than the overall: a high overall with
`misconception` averaging 2 is worse than a mid overall with all dimensions
balanced.

## Configuration

| Env var                       | Default                  | Purpose                                              |
|-------------------------------|--------------------------|------------------------------------------------------|
| `EVAL_SAMPLE_SIZE`            | 100                      | Number of QA rows to ingest/evaluate                 |
| `EVAL_DISTRACTOR_PASSAGES`    | 500                      | Extra non-relevant passages added during ingestion   |
| `EVAL_EMBED_MIN_INTERVAL_SEC` | 0.7                      | Min seconds between passage embedding calls          |
| `EVAL_K_VALUES`               | `1,3,5,10`               | k values for retrieval@k metrics                     |
| `EVAL_GEN_MIN_INTERVAL_SEC`   | 20                       | Min seconds between LLM calls (Ragas eval)           |
| `EVAL_GEN_MAX_ATTEMPTS`       | 12                       | Retries on transient LLM errors                      |
| `EVAL_GEN_MAX_WAIT_SEC`       | 300                      | Max backoff per retry (seconds)                      |
| `EVAL_THINKING_LEVEL`         | (unset)                  | Gemini thinking-level override                       |
| `EVAL_FORCE_HTTPX`            | 1                        | Force httpx transport (avoids aiohttp warning noise) |
| `EVAL_CHAT_MODEL`             | `LLM_MODEL`              | Gemini model for answer generation                   |
| `EVAL_OPENAI_API_KEY`         | (unset)                  | OpenAI key for Ragas and tutoring judges             |
| `EVAL_JUDGE_MODEL`            | `gpt-4o`                 | OpenAI model for Ragas judgment                      |
| `EVAL_JUDGE_EMBEDDING_MODEL`  | `text-embedding-3-small` | OpenAI embeddings for Ragas answer relevancy         |
| `EVAL_TUTORING_JUDGE_MODEL`   | `EVAL_JUDGE_MODEL`       | OpenAI model for pedagogical rubric judgment         |
| `EVAL_TUTORING_SOURCE`        | `tutorbench`             | Tutoring eval source: `tutorbench` or `local`        |
| `EVAL_TUTORING_DATASET`       | `ScaleAI/TutorBench`     | Hugging Face dataset used for TutorBench eval        |
| `EVAL_TUTORING_SAMPLE_SIZE`   | 100                      | Number of TutorBench rows to evaluate                |
| `EVAL_TUTORING_INCLUDE_MULTIMODAL` | 0                  | Include image-backed TutorBench rows                 |
| `EVAL_CHECKPOINT_PATH`        | `ragas_answers_checkpoint.json` | Override checkpoint location                  |
| `EVAL_RESULTS_PATH`           | `retrieval_results.csv`  | Override retrieval-eval CSV output path              |
| `EVAL_TUTORING_SCENARIOS_PATH`| `tutoring_scenarios.json`| Local fallback scenarios when `EVAL_TUTORING_SOURCE=local` |
| `EVAL_TUTORING_RESULTS_PATH`  | `tutoring_results.csv`   | Override tutoring-eval CSV output path               |
| `EVAL_TUTORING_CHECKPOINT_PATH` | `tutoring_responses_checkpoint.json` | Override tutoring checkpoint path        |

## Why this dataset

`rag-mini-bioasq` was chosen for two properties:

1. **Ground-truth relevance labels.** Each question has a `relevant_passage_ids`
   list, which makes deterministic retrieval metrics possible without an LLM
   judge. Most "RAG benchmark" datasets ship only QA pairs, which forces every
   retrieval evaluation to be LLM-judged and noisy.
2. **Passage characteristics that approximate study materials.** Biomedical
   abstracts are roughly the size and language register of textbook excerpts
   and lecture notes — the actual material type students upload to Sapient in
   production.

The benchmark is **not** tutoring-specific; it does not measure Socratic
prompting, weak-area selection, or quiz generation quality. TutorBench covers
the teaching-behavior portion separately through tutoring prompts and
sample-specific rubrics.

## Outputs (gitignored)

The following files are produced by running the evals and are excluded from
version control:

- `evals/eval_corpus_map.json` — passage → material ID mapping (RAG evals)
- `evals/ragas_answers_checkpoint.json` — checkpointed generated answers (Ragas eval)
- `evals/ragas_scores_checkpoint.json` — per-row judge scores (Ragas judge-only)
- `evals/ragas_results.csv` — per-row Ragas scores
- `evals/retrieval_results.csv` — per-question retrieval scores
- `evals/tutoring_responses_checkpoint.json` — checkpointed tutor responses + judge scores
- `evals/tutoring_results.csv` — per-scenario tutoring scores
