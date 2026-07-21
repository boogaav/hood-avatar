// single source of truth for the generation prompt — used by server.js (local)
// and worker/index.js (Cloudflare prod)

export const hoodPrompt = (emblem) =>
  [
    'Redraw the person from the first input image as a high-quality pixel-art avatar:',
    'bust portrait on a plain light-gray background, rendered in clean detailed pixel art',
    'with visible pixel clusters and smooth shading.',
    'They wear an oversized bright lime-green (chartreuse) hoodie with the hood pulled up',
    'over their head, a chunky black metal zipper, black drawstrings, and bold black',
    'tiger-claw stripe markings on the hood, shoulders and sleeves.',
    `On the left chest is a black diamond-shaped emblem with the word '${emblem}' in bold`,
    'letters sized to fit the diamond, and on the right chest a black feather emblem.',
    `The chest emblem text must read exactly '${emblem}' — spelled letter-for-letter as`,
    `${emblem.split('').join('-')} (${emblem.length} letters, double letters included),`,
    'even if a style reference image shows a different word.',
    "Preserve the person's facial likeness: face shape, hair color, skin tone, expression,",
    'and any glasses, hat or accessories they wear (if they wear a hat, keep the hat and',
    'drape the hood behind their head instead). Square 1:1 image.',
  ].join(' ')

export const withStyleRoles = (basePrompt) =>
  [
    'INPUT ROLES — follow strictly:',
    'The FIRST image is the person to portray. Their entire identity — face, facial features,',
    'hair, skin tone, expression, glasses, hat, accessories — must come EXCLUSIVELY from the',
    'first image. If the first image is not a clear human face (a logo, sketch or object),',
    'stylize THAT subject inside the hoodie instead of inventing a person.',
    'The SECOND image is a STYLE GUIDE ONLY: copy its pixel-art rendering technique, hoodie',
    'design, colors and background. NEVER copy the face, hair or any identity feature from',
    'the second image.',
    `TASK: ${basePrompt}`,
  ].join(' ')

// the same key format works against either the Gemini API or Vertex AI express
// endpoint depending on which Google project it comes from — callers try both.
// the global aiplatform host geo-routes; some regions (e.g. asia-southeast1)
// lack the image models, so a US-pinned host is the final fallback.
export const GEMINI_ENDPOINTS = [
  (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`,
  (m) => `https://aiplatform.googleapis.com/v1/publishers/google/models/${m}:generateContent`,
  (m) => `https://us-central1-aiplatform.googleapis.com/v1/publishers/google/models/${m}:generateContent`,
]

export const GEMINI_MODELS = ['gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview']
