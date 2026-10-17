import fs from 'fs';

const apiKey = 'sk-live-cdc3db26f29e4fcdba9b0efb075fb5f438d9cc6c2642361b96f6d690e54f75e8';

const visualTraits = 'a cheerful young adult male with short dark hair, clear-rimmed glasses, friendly warm smile with visible teeth, wearing a black t-shirt and open light striped collared shirt';

const prompt = `A cute chibi character avatar of ${visualTraits}. Cute storybook sticker art style with soft volumetric 3D dimensional shading, smooth lighting, adorable rounded chibi proportions like modern Pixar or Animal Crossing, big expressive eyes with glossy catchlights behind clear glasses, soft pink cheek blush, and warm vibrant colors. Front-facing centered portrait bust (head, neck and upper shoulders only), isolated on a pure solid white background. High quality digital illustration.`;

console.log('Generating with storybook 3D chibi prompt...');
const res = await fetch('https://api.aicredits.in/v1/images/generations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    model: 'black-forest-labs/flux-1-schnell',
    prompt,
    n: 1,
    size: '1024x1024',
  }),
});

const data = await res.json();
const b64 = data.data?.[0]?.b64_json;
if (b64) {
  fs.writeFileSync('scratch_storybook_chibi.jpg', Buffer.from(b64, 'base64'));
  console.log('Saved storybook chibi to scratch_storybook_chibi.jpg!');
} else {
  console.log('Response:', data);
}
