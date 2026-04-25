import { Router, type IRouter } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router: IRouter = Router();

router.post("/claude", async (req, res) => {
  try {
    const { model, max_tokens, messages } = req.body as {
      model: string;
      max_tokens: number;
      messages: Array<{ role: "user" | "assistant"; content: unknown }>;
    };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: { message: "messages array is required" } });
      return;
    }

    const safeModel = "claude-sonnet-4-6";
    const safeMaxTokens = Math.min(Number(max_tokens) || 900, 8192);

    const response = await anthropic.messages.create({
      model: safeModel,
      max_tokens: safeMaxTokens,
      messages: messages as Array<{ role: "user" | "assistant"; content: string | Array<{ type: string; [key: string]: unknown }> }>,
    });

    res.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    req.log.error({ err }, "Claude proxy error");
    res.status(500).json({ error: { message } });
  }
});

export default router;
