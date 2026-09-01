import { NextResponse } from "next/server";
import { askAnalyst } from "../../../lib/analyst.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req) {
  const { question, strictMode } = await req.json();
  if (!question?.trim()) return NextResponse.json({ error: "empty question" }, { status: 400 });
  try {
    const result = await askAnalyst({ question: question.trim(), strictMode: !!strictMode });
    return NextResponse.json(result);
  } catch (e) {
    console.error("analyst error", e);
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
