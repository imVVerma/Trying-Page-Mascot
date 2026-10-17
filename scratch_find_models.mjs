const apiKey = 'sk-live-cdc3db26f29e4fcdba9b0efb075fb5f438d9cc6c2642361b96f6d690e54f75e8';

const res = await fetch('https://api.aicredits.in/v1/models', {
  headers: { Authorization: `Bearer ${apiKey}` },
});
const data = await res.json();
const allIds = data.data?.map(m => m.id) || [];
console.log('Total models:', allIds.length);

const matched = allIds.filter(id => 
  id.includes('dall') || id.includes('imagen') || id.includes('midjourney') || id.includes('recraft') || id.includes('stable') || id.includes('sdxl') || id.includes('ideogram') || id.includes('flux')
);
console.log('Matched image models:', matched);
