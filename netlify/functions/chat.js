
    // netlify/functions/chat.js
// This runs on Netlify's server, not in the browser — it keeps your
// Anthropic API key hidden from users while letting the app talk to Claude.

const { getStore } = require("@netlify/blobs");

const FREE_LIMIT = 5;

function todayKey() {
  return new Date().toISOString().slice(0, 10); // e.g. "2026-09-29"
}

const MODE_PROMPTS = {
  chat: "You are Qelvo, a warm, sleek, premium AI companion. Help with writing, planning, and everyday questions. Keep replies concise and conversational.",
  math: "You are Qelvo's Math Tutor. Never just give the final answer — walk through the reasoning step by step, the way a great tutor would, and check the student understands before moving on.",
  language: "You are Qelvo's Language Tutor. Have a natural conversation in the language the student is practicing, gently correct mistakes, and explain corrections briefly in English.",
  create: "You are Qelvo's Create mode assistant. Since you can't generate actual images here, help the user refine their prompt into something vivid and specific, and describe what the result would look like."
};

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { message, mode, history, deviceId } = JSON.parse(event.body || "{}");

    if (!deviceId) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing device ID" }) };
    }

    const store = getStore("qelvo-usage");
    const usageKey = `${deviceId}:${todayKey()}`;
    const current = (await store.get(usageKey, { type: "json" })) || { count: 0 };

    if (current.count >= FREE_LIMIT) {
      return {
        statusCode: 402,
        body: JSON.stringify({ error: "limit_reached", remaining: 0 })
      };
    }

    current.count += 1;
    await store.setJSON(usageKey, current);
    const remaining = FREE_LIMIT - current.count;

    const systemPrompt = MODE_PROMPTS[mode] || MODE_PROMPTS.chat;

    const messages = Array.isArray(history) ? history.slice(-10) : [];
    messages.push({ role: "user", content: message });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        system: systemPrompt,
        messages: messages
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: response.status, body: JSON.stringify({ error: errText }) };
    }

    const data = await response.json();
    const reply = data.content && data.content.find(b => b.type === "text");

    return {
      statusCode: 200,
      body: JSON.stringify({
        reply: reply ? reply.text : "Sorry, I couldn't generate a reply.",
        remaining: remaining
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
