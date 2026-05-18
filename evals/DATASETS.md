# Evaluation Dataset Options

This note records the dataset choice before running the eval suite. The short
version: keep `rag-mini-bioasq` for RAG, increase it to 100 judged rows, and
use `ScaleAI/TutorBench` for tutoring behavior instead of the local generated
scenario file.

## Recommended Next Run

Use the current setup:

- `rag-datasets/rag-mini-bioasq`
- `EVAL_SAMPLE_SIZE=100`
- `EVAL_DISTRACTOR_PASSAGES=500`
- `ScaleAI/TutorBench` with `EVAL_TUTORING_SAMPLE_SIZE=100`

Why: `rag-mini-bioasq` has question rows, reference answers, and
`relevant_passage_ids`, so the same rows can support deterministic retrieval
metrics and Ragas-style answer judging. That is much cleaner than switching to
a dataset that only has QA pairs and would need an LLM judge for retrieval too.

## Dataset Candidates

| Dataset | Best use | Why it helps | Tradeoff |
| --- | --- | --- | --- |
| `rag-datasets/rag-mini-bioasq` | Current RAG + Ragas eval | Includes QA rows, reference answers, relevant passage IDs, and a text corpus. Small enough to run locally through pgvector. | Biomedical domain, not education-specific. |
| `ScaleAI/TutorBench` | Main tutoring-behavior eval | Public TutorBench split has about 1.47k rows with tutoring prompts, follow-ups, subjects, and sample-specific rubrics. | Some rows are multimodal; the current harness skips image-backed rows by default. |
| BEIR | Retrieval-only benchmark | Standard IR benchmark suite with qrels and common retrieval metrics across many domains. Useful for a reranker story. | Not an end-to-end tutoring/RAG generation dataset; needs adapter work. |
| HotpotQA | Multi-hop RAG stress test | Questions require connecting evidence across documents and include supporting facts. Good for testing whether retrieval finds enough context. | Wikipedia domain; adapter needed for our ingestion and relevance mapping. |
| KILT | Knowledge-intensive QA with evidence | Unifies multiple tasks against a shared Wikipedia knowledge source and evaluates answer plus evidence behavior. | Heavier benchmark; overkill for the immediate project eval. |
| ScienceQA | Education-flavored QA | Science curriculum questions include lectures and explanations, which is closer to tutoring content. | Multiple-choice and multimodal; does not directly match current text-only RAG pipeline. |
| ASSISTments / EdNet | Knowledge tracing | Real student interaction sequences for mastery/KT evaluation. Useful for BKT/DKT later. | Not a RAG dataset; does not judge tutor response quality. |

## Decision

For the next eval, do not swap datasets. Run:

1. `retrieval_eval.py` on 100 `rag-mini-bioasq` rows.
2. `ragas_eval.py` on the same 100 rows.
3. `tutoring_eval.py` on 100 text-only TutorBench rows.

This gives three different stories without changing too much at once:

- Retrieval quality: deterministic recall/precision/MRR.
- Answer quality: Ragas/OpenAI judge over answer-grounding metrics.
- Tutor quality: OpenAI rubric judge over TutorBench prompts and
  sample-specific rubrics.

## Future Dataset Work

Use BEIR next if the goal is to show a retrieval or reranking improvement.
That would pair well with a LangSearch reranker evaluation: compare pgvector
top-k alone vs. pgvector top-50 plus reranking.

Use ASSISTments or EdNet later if the goal is to evaluate knowledge tracing.
Those datasets measure whether the model predicts future student correctness,
which is a separate evaluation from RAG answer quality.

Use ScienceQA later if we want an education-themed generation benchmark. It
will need a small adapter because our current eval expects free-response QA
with retrieved text chunks, not multimodal multiple-choice questions.

Keep `evals/tutoring_scenarios.json` only as a small local fallback or
regression fixture. It should not be the headline tutoring eval because the
rows were generated for this project rather than drawn from a public benchmark.

## Sources

- rag-mini-bioasq: https://huggingface.co/datasets/rag-datasets/rag-mini-bioasq
- ScaleAI TutorBench: https://huggingface.co/datasets/ScaleAI/TutorBench
- BEIR: https://github.com/beir-cellar/beir
- HotpotQA: https://hotpotqa.github.io/
- KILT: https://ai.meta.com/tools/kilt/
- ScienceQA: https://scienceqa.github.io/index.html
- EdNet: https://arxiv.org/abs/1912.03072
- ASSISTments datasets: https://huggingface.co/ASSISTments/datasets
