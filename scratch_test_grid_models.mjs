import fs from 'fs';

const apiKey = 'sk-live-cdc3db26f29e4fcdba9b0efb075fb5f438d9cc6c2642361b96f6d690e54f75e8';

const prompt = `A 3x3 grid sprite sheet of a cute chibi cartoon avatar of a young adult male with short dark hair, clear-rimmed glasses, friendly smile with visible teeth, wearing a black t-shirt and open light striped collared shirt. Clean bold black outlines, big expressive eyes behind glasses, soft blush, and warm vibrant colors.

This sheet contains NINE HEAD DIRECTIONS - the face maintains the same happy smiling expression while the head turns in 9 angles:
Row 1: looking up-left, looking straight up, looking up-right.
Row 2: looking left, looking straight at viewer, looking right.
Row 3: looking down-left, looking straight down, looking down-right.

LAYOUT: Exactly 3 columns by 3 rows grid of 9 character busts on a solid uniform bright magenta (#FF00FF) chroma-key background. 
FRAMING: Portrait bust (head, neck, and upper shoulders only). No hands, no arms, no lower body.
CONSISTENCY: The shoulders and shirt must be identical in size, position, and facing straight forward across all 9 cells; only the head rotates.
MARGINS: Each chibi bust is centered in its 1/3 x 1/3 cell with generous empty magenta space around it. No borders, no grid lines, no text.`;

async function testModel(modelName, outFilename) {
  console.log(`Testing ${modelName}...`);
  try {
    const res = await fetch('https://api.aicredits.in/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        prompt,
        n: 1,
        size: '1024x1024',
      }),
    });
    console.log(`${modelName} status:`, res.status);
    const data = await res.json();
    let b64 = data.data?.[0]?.b64_json;
    let url = data.data?.[0]?.url;
    if (b64) {
      fs.writeFileSync(outFilename, Buffer.from(b64, 'base64'));
      console.log(`Saved ${modelName} result to ${outFilename}`);
      return true;
    } else if (url) {
      console.log(`Got URL for ${modelName}:`, url);
      const imgRes = await fetch(url);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      fs.writeFileSync(outFilename, buf);
      console.log(`Saved downloaded image to ${outFilename}`);
      return true;
    } else {
      console.log(`${modelName} response:`, data);
      return false;
    }
  } catch (err) {
    console.error(`Error on ${modelName}:`, err);
    return false;
  }
}

// Test models in sequence
await testModel('openai/dall-e-3', 'scratch_dalle3_grid.png');
await testModel('black-forest-labs/flux-1.1-pro', 'scratch_flux_pro_grid.png');
