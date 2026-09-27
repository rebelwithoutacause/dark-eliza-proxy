// Serverless text-to-speech for the Dark-ELIZA frontend. Only used as a
// fallback by browsers without the Web Speech API (notably Android in-app
// browsers, whose WebView doesn't expose speechSynthesis) - the page
// sends Eliza's reply text, this turns it into speech with Gemini TTS and
// returns playable WAV audio. Keeps GEMINI_API_KEY server-side only, same
// as api/chat.js.

const ALLOWED_ORIGIN = 'https://rebelwithoutacause.github.io';
const TTS_MODEL = 'gemini-3.8-flash-lite-tts';
const TTS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const TTS_VOICE = 'Achernar';
const TTS_STYLE = 'quiet, weary and faintly unsettling';

// Replies are capped at 150 output tokens in api/chat.js (~600 chars), and
// the offline fallback lines are far shorter. Anything much longer isn't an
// Eliza reply, so refuse it rather than let a public endpoint synthesize
// arbitrary text on this key. Keep in sync with TTS_MAX_CHARS in the
// frontend's script.js.
const MAX_TEXT_LENGTH = 700;

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

    const { text } = req.body || {};

    if (typeof text !== 'string' || !text.trim()) {
        res.status(400).json({ error: 'Missing text' });
        return;
    }
    if (text.length > MAX_TEXT_LENGTH) {
        res.status(400).json({ error: 'Text too long' });
        return;
    }

    try {
        const geminiResponse = await fetch(TTS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify({
                model: TTS_MODEL,
                input: [{
                    type: 'user_input',
                    content: [{
                        type: 'text',
                        text: text.trim(),
                        annotations: [{ type: 'speech_metadata', style: TTS_STYLE }]
                    }]
                }],
                // WAV is already the unary default; pinned so a default change
                // can't hand the browser a format decodeAudioData can't read.
                response_format: { type: 'audio', mime_type: 'audio/wav' },
                generation_config: {
                    speech_config: [{ voice: TTS_VOICE }]
                },
                // The Interactions API stores requests by default (1 day on
                // the free tier, 55 on paid). Nothing here reads them back, so
                // don't retain visitors' reply text.
                store: false
            })
        });

        if (!geminiResponse.ok) {
            const errBody = await geminiResponse.text();
            console.error('Gemini TTS error', geminiResponse.status, errBody);
            res.status(502).json({ error: 'Upstream error' });
            return;
        }

        // Same selection as Google's REST example: the last "audio" content
        // block of the "model_output" steps, whose base64 `data` is a
        // complete WAV file (24 kHz mono 16-bit PCM with a RIFF header).
        const data = await geminiResponse.json();
        const audio = (data?.steps || [])
            .filter(step => step?.type === 'model_output')
            .flatMap(step => step.content || [])
            .filter(part => part?.type === 'audio' && typeof part.data === 'string')
            .pop();

        if (!audio) {
            console.error('Gemini TTS returned no audio block');
            res.status(502).json({ error: 'Empty response' });
            return;
        }

        const wav = Buffer.from(audio.data, 'base64');
        const isWav = (!audio.mime_type || audio.mime_type === 'audio/wav')
            && wav.length > 44
            && wav.toString('ascii', 0, 4) === 'RIFF'
            && wav.toString('ascii', 8, 12) === 'WAVE';
        if (!isWav) {
            console.error('Gemini TTS returned non-WAV audio', audio.mime_type);
            res.status(502).json({ error: 'Unexpected audio format' });
            return;
        }

        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).send(wav);
    } catch (error) {
        console.error('TTS proxy failure', error);
        res.status(500).json({ error: 'Proxy failure' });
    }
};
