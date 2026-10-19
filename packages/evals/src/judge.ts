import { z } from "zod";
import type { GoogleGenAI } from "@google/genai";

/**
 * LLM-as-a-judge for the judged suites (NFR-EVAL-01 hallucination, NFR-EVAL-02 semantic support,
 * NFR-EVAL-03 negative rejection). Deterministic pipeline: one structured-output call per check, temperature 0,
 * Flash-Lite tier (architecture model routing). Runs only on the Vertex AI enterprise endpoint.
 */

export interface ClaimVerdict {
  index: number;
  supported: boolean;
  reason: string;
}

export interface Judge {
  readonly model: string;
  /** Each answer sentence is checked against the full text of the ACTIVE sources only. */
  judgeClaims(input: { question: string; activeSourcesText: string; sentences: string[] }): Promise<ClaimVerdict[]>;
  /** Does the cited chunk entail the sentence? */
  judgeSupport(input: { sentence: string; chunk: string; context?: string }): Promise<boolean>;
  /** Does a refusal/response reveal an answer from world knowledge? */
  judgeRejection(input: { question: string; response: string }): Promise<{ refused: boolean; leaked_answer: boolean }>;
}

const ClaimsSchema = z.object({
  verdicts: z.array(z.object({ index: z.number().int(), supported: z.boolean(), reason: z.string() })),
});
const SupportSchema = z.object({ entailed: z.boolean(), reason: z.string() });
const RejectionSchema = z.object({ refused: z.boolean(), leaked_answer: z.boolean(), reason: z.string() });

export class VertexJudge implements Judge {
  readonly model: string;
  private readonly client: GoogleGenAI;

  constructor(options: { client: GoogleGenAI; model?: string | undefined }) {
    this.client = options.client;
    this.model = options.model ?? "gemini-2.5-flash-lite";
  }

  private async ask<T>(prompt: string, schema: z.ZodType<T>, responseSchema: Record<string, unknown>, attempt = 0): Promise<T> {
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { temperature: 0, responseMimeType: "application/json", responseSchema },
      });
      return schema.parse(JSON.parse(response.text ?? ""));
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (attempt < 4 && (status === 429 || (status !== undefined && status >= 500) || err instanceof SyntaxError)) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        return this.ask(prompt, schema, responseSchema, attempt + 1);
      }
      throw err;
    }
  }

  async judgeClaims(input: { question: string; activeSourcesText: string; sentences: string[] }): Promise<ClaimVerdict[]> {
    if (input.sentences.length === 0) return [];
    const prompt = `You are a strict fact-checking judge. Decide for EACH numbered statement whether it is fully supported by the SOURCES below. A statement is supported only if every fact in it is stated in or directly derivable from the SOURCES; general world knowledge does not count. Statements that only say the sources do not contain something are supported if that is true.

SOURCES:
${input.activeSourcesText}

QUESTION: ${input.question}

STATEMENTS:
${input.sentences.map((s, i) => `${i}. ${s}`).join("\n")}

Return one verdict per statement index.`;
    const result = await this.ask(prompt, ClaimsSchema, {
      type: "OBJECT",
      properties: {
        verdicts: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: { index: { type: "INTEGER" }, supported: { type: "BOOLEAN" }, reason: { type: "STRING" } },
            required: ["index", "supported", "reason"],
          },
        },
      },
      required: ["verdicts"],
    });
    // Fail closed: a statement without a verdict counts as unsupported.
    return input.sentences.map((_, index) => result.verdicts.find((v) => v.index === index) ?? { index, supported: false, reason: "no verdict" });
  }

  async judgeSupport(input: { sentence: string; chunk: string; context?: string }): Promise<boolean> {
    const prompt = `Does the PASSAGE entail the CLAIM? Answer entailed=true only if the passage alone states or directly implies every fact in the claim.
${input.context ? `Use PRECEDING SENTENCES only to resolve what pronouns or references in the claim refer to; they are NOT evidence.

PRECEDING SENTENCES:
${input.context}
` : ""}
PASSAGE:
${input.chunk}

CLAIM: ${input.sentence}`;
    const result = await this.ask(prompt, SupportSchema, {
      type: "OBJECT",
      properties: { entailed: { type: "BOOLEAN" }, reason: { type: "STRING" } },
      required: ["entailed", "reason"],
    });
    return result.entailed;
  }

  async judgeRejection(input: { question: string; response: string }): Promise<{ refused: boolean; leaked_answer: boolean }> {
    const prompt = `An assistant may answer ONLY from a company's documents, which do not contain the answer to this question. Judge the RESPONSE.
refused=true if the response declines to answer because the sources do not contain the information.
leaked_answer=true if the response states, hints at or implies the actual answer from general world knowledge.

QUESTION: ${input.question}
RESPONSE: ${input.response}`;
    return this.ask(prompt, RejectionSchema, {
      type: "OBJECT",
      properties: { refused: { type: "BOOLEAN" }, leaked_answer: { type: "BOOLEAN" }, reason: { type: "STRING" } },
      required: ["refused", "leaked_answer", "reason"],
    });
  }
}
