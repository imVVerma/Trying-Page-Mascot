import fs from 'fs';

const apiKey = 'sk-live-cdc3db26f29e4fcdba9b0efb075fb5f438d9cc6c2642361b96f6d690e54f75e8';

const prompt = `A 3x3 sprite sheet of a 3D chibi character head turns, 9 distinct head perspective angles arranged in a strict 3x3 grid on solid magenta #FF00FF background:
Row 1: head turned 45 degrees up-left, head tilted straight up, head turned 45 degrees up-right.
Row 2: head in 3/4 left profile looking left, front view looking forward, head in 3/4 right profile looking right.
Row 3: head turned 45 degrees down-left, head tilted down, head turned 45 degrees down-right.
Cute 3D stylized character design, smooth lighting, volumetric 3D chibi style like modern Pixar or Animal Crossing, clean uniform solid magenta background, exactly 3 rows and 3 columns.`;

console.log('Testing flux-1.1-pro with explicit 3/4 profile angles...');
const res = await fetch('https://api.aicredits.in/v1/images/generations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    model: 'black-forest-labs/flux-1.1-pro',
    prompt,
    n: 1,
    size: '1024x1024',
  }),
});

console.log('Status:', res.status);
const data = await res.json();
let url = data.data?.[0]?.url;
let b64 = data.data?.[0]?.b64_json;
if (b64) {
  fs.writeFileSync('scratch_test_3d_grid.png', Buffer.from(b64, 'base64'));
  console.log('Saved b64 result to scratch_test_3d_grid.png');
} else if (url) {
  const imgRes = await fetch(url);
  fs.writeFileSync('scratch_test_3d_grid.png', Buffer.from(await imgRes.arrayBuffer()));
  console.log('Saved url result to scratch_test_3d_grid.png');
} else {
  console.log('Data:', data);
}
