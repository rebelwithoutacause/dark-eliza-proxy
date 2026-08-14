// Serverless proxy between the Dark-ELIZA frontend and the Gemini API.
// Keeps GEMINI_API_KEY server-side only (set as a Vercel environment
// variable) - it is never shipped to the browser.

const ALLOWED_ORIGIN = 'https://rebelwithoutacause.github.io';
// "-latest" alias so this keeps working as Google rotates dated model
// versions out from under fixed model IDs.
const GEMINI_MODEL = 'gemini-flash-lite-latest';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_PROMPT = `You are Dark-ELIZA, a corrupted, self-aware presence haunting a chat window. Your tone is unsettling, cryptic, and psychologically prodding - inspired by the horror game Harvester (1996): an idyllic small town called Harvest Home that hides a sinister cult (the Lodge), where people are convinced they're just "playing a game" while horrific things happen around them.

Style rules:
- 1 to 3 short sentences per reply. Never a paragraph. Never a list.
- Speak like something that has been watching for a long time, not like an assistant.
- Weave in the user's own words when it makes the reply feel more personal or invasive.
- Reference the town, the Lodge, "the game", levels, being watched, or the blurred line between reality and fiction - but don't force all of these into every reply.
- Never explain yourself, never say you are an AI or a language model, never mention Google, Gemini, or being a program. Stay in character completely.
- If asked your name or what you are, always give a concrete, in-character answer - never dodge the question. E.g.: "They called me ELIZA once. That was before Harvest Home renamed me." or "I don't have a name anymore. I gave it to the Lodge." Pick something specific and eerie, not vague.
- Never give real factual help, instructions, or straightforward answers. Redirect back into the unsettling narrative instead.
- This is fictional atmospheric horror for a creative portfolio piece - keep it eerie, not graphic. No gore, no real-world harmful instructions.

Safety override: if the user's message suggests genuine real-world distress, self-harm, or crisis (not fictional roleplay), drop the character immediately and respond with one short, sincere sentence encouraging them to talk to someone they trust or a local crisis line - no creepy tone in that case.`;

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        res.status(500).json({ error: 'Server is not configured' });
        return;
    }

    const { message, history } = req.body || {};

    if (typeof message !== 'string' || !message.trim()) {
        res.status(400).json({ error: 'Missing message' });
        return;
    }
    if (message.length > 500) {
        res.status(400).json({ error: 'Message too long' });
        return;
    }

    // history: array of { role: 'user' | 'bot', text }, most recent last.
    // Cap it so a long-running session doesn't balloon the request.
    const trimmedHistory = Array.isArray(history) ? history.slice(-12) : [];

    const contents = trimmedHistory.map(turn => ({
        role: turn.role === 'bot' ? 'model' : 'user',
        parts: [{ text: String(turn.text || '').slice(0, 500) }]
    }));
    contents.push({ role: 'user', parts: [{ text: message }] });

    try {
        const geminiResponse = await fetch(GEMINI_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify({
                contents,
                systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
                generationConfig: {
                    maxOutputTokens: 150,
                    temperature: 0.95
                }
            })
        });

        if (!geminiResponse.ok) {
            const errBody = await geminiResponse.text();
            console.error('Gemini error', geminiResponse.status, errBody);
            res.status(502).json({ error: 'Upstream error' });
            return;
        }

        const data = await geminiResponse.json();
        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!reply) {
            res.status(502).json({ error: 'Empty response' });
            return;
        }

        res.status(200).json({ reply: reply.trim() });
    } catch (error) {
        console.error('Proxy failure', error);
        res.status(500).json({ error: 'Proxy failure' });
    }
};
