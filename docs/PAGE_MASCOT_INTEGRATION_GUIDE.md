**`page-mascot`** is an interactive React component by Kamran Ahmed (`nilbuild`) that renders a cursor-tracking character from two **3×3 WebP sprite sheets**:

1. **`directions` sheet (3×3 grid):** 9 head angles (`top-left`, `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom`, `bottom-right`). It includes a 70px center dead-zone and sector hysteresis so the head settles smoothly without jittering.
2. **`reactions` sheet (3×3 grid):** 9 expressions (`blink`, `heart`, `sparkle`, `surprised`, `wink`, `shy`, `sleepy`, `dizzy`, `happy`). Clicking ("poking") the mascot triggers a squash animation and cycles through expressions—and rapid-clicking it 4+ times makes it dizzy.

Because `page-mascot` ships **only the component logic** on npm (to stay tiny and tree-shakable), you supply the two `.webp` sprite sheets in your `public/mascots/` folder—or pull them directly from the official demo assets while prototyping.

---

### Complete Demo Project: "Mascot Playground & Ward"

Below is a ready-to-run **Vite + React + Tailwind** demo project. It features:

* **Live Character & Art Style Switcher:** Swap between characters (`fox`, `redpanda`, `owl`, `astronaut`, `gearbot`, `cat`) and art styles (`colour`, `ink`, `sketch`, `riso`, `paper`, `pixel`).
* **Remote Asset Fallback:** Automatically loads the official sprite sheets from `[koboyo.com/page-mascot](https://koboyo.com/page-mascot)` out of the box so you can test immediately, while supporting local `/mascots/*.webp` files.
* **Interactive "Boop" Tracker & Inspector:** Tracks your click combos to test the built-in reaction states (Blink → Heart/Sparkle → Dizzy) and lets you inspect the raw 3×3 sprite grids side-by-side.

#### 1. Scaffold & Install

Run these commands in your terminal to spin up the project:

```bash
npm create vite@latest page-mascot-demo -- --template react-ts
cd page-mascot-demo
npm install page-mascot

```

*(Optional)* If you want to store the sprite sheets locally instead of fetching them from the demo host, create `public/mascots/` and download a pair directly:

```bash
mkdir -p public/mascots
curl -o public/mascots/fox-directions.webp https://koboyo.com/page-mascot/mascots/fox-directions.webp
curl -o public/mascots/fox-reactions.webp https://koboyo.com/page-mascot/mascots/fox-reactions.webp

```

---

#### 2. Application Code (`src/App.tsx`)

Replace the contents of `src/App.tsx` with the following playground implementation:

```tsx
import { useState } from 'react';
import { Mascot } from 'page-mascot';

type CharacterId = 'fox' | 'redpanda' | 'owl' | 'astronaut' | 'gearbot' | 'cat' | 'wizard';
type StyleId = 'colour' | 'ink' | 'sketch' | 'riso' | 'paper' | 'pixel';

const CHARACTERS: { id: CharacterId; name: string; role: string }[] = [
  { id: 'fox', name: 'Fox', role: 'Default Watcher' },
  { id: 'redpanda', name: 'Red Panda', role: 'Bamboo Debugger' },
  { id: 'owl', name: 'Owl', role: 'Night Owl Reviewer' },
  { id: 'astronaut', name: 'Astronaut', role: 'Space Explorer' },
  { id: 'gearbot', name: 'Gearbot', role: 'CI/CD Automator' },
  { id: 'cat', name: 'Cat', role: 'Keyboard Stepper' },
  { id: 'wizard', name: 'Wizard', role: 'Regex Sorcerer' },
];

const STYLES: { id: StyleId; label: string; desc: string }[] = [
  { id: 'colour', label: 'Colour', desc: 'Default full colour' },
  { id: 'ink', label: 'Ink', desc: 'Black line art' },
  { id: 'sketch', label: 'Sketch', desc: 'Pencil shading' },
  { id: 'riso', label: 'Riso', desc: 'Two-tone print' },
  { id: 'paper', label: 'Paper', desc: 'Cut-paper craft' },
  { id: 'pixel', label: 'Pixel', desc: '32px retro sprite' },
];

export default function App() {
  const [character, setCharacter] = useState<CharacterId>('fox');
  const [style, setStyle] = useState<StyleId>('colour');
  const [size, setSize] = useState<number>(160);
  const [useLocal, setUseLocal] = useState<boolean>(false);
  const [showSheets, setShowSheets] = useState<boolean>(false);
  const [pokeCount, setPokeCount] = useState<number>(0);

  // Koboyo's demo page serves default colour sheets and style variants.
  // Toggle `useLocal` once you drop files into your `public/mascots/` directory.
  const baseUrl = useLocal ? '/mascots' : 'https://koboyo.com/page-mascot/mascots';
  const prefix = style === 'colour' ? character : `${character}-${style}`;

  const directionsUrl = `${baseUrl}/${prefix}-directions.webp`;
  const reactionsUrl = `${baseUrl}/${prefix}-reactions.webp`;

  return (
    <div style={styles.page}>
      {/* Top Navbar with Perched Mascot */}
      <header style={styles.header}>
        <div style={styles.brand}>
          <span style={styles.badge}>page-mascot v0.1.0</span>
          <h1 style={styles.title}>Interactive Mascot Sandbox</h1>
        </div>

        <div style={styles.sourceToggle}>
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={useLocal}
              onChange={(e) => setUseLocal(e.target.checked)}
            />
            Serve from local <code>/public/mascots/</code>
          </label>
        </div>
      </header>

      {/* Main Stage */}
      <main style={styles.mainGrid}>
        {/* Left Card: Live Interactive Mascot */}
        <section style={styles.stageCard}>
          <div style={styles.mascotStage} onClick={() => setPokeCount((c) => c + 1)}>
            <Mascot
              key={`${directionsUrl}-${size}`}
              directions={directionsUrl}
              reactions={reactionsUrl}
              size={size}
              label={`${character} mascot in ${style} style`}
            />
          </div>

          <div style={styles.stageFooter}>
            <p style={styles.hintText}>
              Move your cursor around the page to test the <strong>9-way angle tracking</strong> and{' '}
              <strong>70px center dead-zone</strong>. Click rapidly 4 times to trigger the{' '}
              <em>dizzy</em> state!
            </p>
            <div style={styles.statsRow}>
              <span>Total Pokes: <strong>{pokeCount}</strong></span>
              <span>Active Grid: <strong>3×3 WebP</strong></span>
              <span>Size: <strong>{size}px</strong></span>
            </div>
          </div>
        </section>

        {/* Right Card: Controls & Props */}
        <section style={styles.controlsCard}>
          <h2 style={styles.sectionHeading}>1. Pick a Character</h2>
          <div style={styles.buttonGrid}>
            {CHARACTERS.map((char) => (
              <button
                key={char.id}
                onClick={() => setCharacter(char.id)}
                style={{
                  ...styles.OptionBtn,
                  ...(character === char.id ? styles.OptionBtnActive : {}),
                }}
              >
                <div style={{ fontWeight: 600 }}>{char.name}</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.75 }}>{char.role}</div>
              </button>
            ))}
          </div>

          <h2 style={styles.sectionHeading}>2. Rendering Style (Same 3×3 Alignment)</h2>
          <div style={styles.styleGrid}>
            {STYLES.map((s) => (
              <button
                key={s.id}
                onClick={() => setStyle(s.id)}
                style={{
                  ...styles.OptionBtn,
                  ...(style === s.id ? styles.OptionBtnActive : {}),
                }}
              >
                <div style={{ fontWeight: 600 }}>{s.label}</div>
                <div style={{ fontSize: '0.7rem', opacity: 0.75 }}>{s.desc}</div>
              </button>
            ))}
          </div>

          <h2 style={styles.sectionHeading}>3. Component Props</h2>
          <div style={styles.sliderRow}>
            <label htmlFor="size-slider">
              <code>size={`{${size}}`}</code>
            </label>
            <input
              id="size-slider"
              type="range"
              min={80}
              max={260}
              step={10}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              style={{ flex: 1 }}
            />
          </div>

          {/* Generated JSX Snippet */}
          <div style={styles.codeBlock}>
            <pre style={{ margin: 0, overflowX: 'auto' }}>
{`import { Mascot } from 'page-mascot'

<Mascot
  directions="${directionsUrl}"
  reactions="${reactionsUrl}"
  size={${size}}
  label="${character} mascot"
/>`}
            </pre>
          </div>

          <button
            onClick={() => setShowSheets((prev) => !prev)}
            style={styles.inspectBtn}
          >
            {showSheets ? 'Hide Raw 3×3 Sprite Sheets' : 'Inspect Raw 3×3 Sprite Sheets'}
          </button>
        </section>
      </main>

      {/* Sprite Sheet Inspector Drawer */}
      {showSheets && (
        <section style={styles.sheetInspector}>
          <div style={styles.sheetBox}>
            <h3 style={styles.sheetTitle}>Directions Sheet (3×3 Angle Lookup)</h3>
            <p style={styles.sheetSub}>
              Top-Left, Top, Top-Right / Left, Center (Dead-zone), Right / Bottom-Left, Bottom, Bottom-Right
            </p>
            <img src={directionsUrl} alt="Directions 3x3 grid" style={styles.sheetImg} />
          </div>
          <div style={styles.sheetBox}>
            <h3 style={styles.sheetTitle}>Reactions Sheet (3×3 Click Expressions)</h3>
            <p style={styles.sheetSub}>
              Blink, Heart, Sparkle / Surprised, Wink, Shy / Sleepy, Dizzy (4x rapid click), Happy
            </p>
            <img src={reactionsUrl} alt="Reactions 3x3 grid" style={styles.sheetImg} />
          </div>
        </section>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    padding: '2rem',
    boxSizing: 'border-box',
  },
  header: {
    maxWidth: '1080px',
    margin: '0 auto 2rem auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '1rem',
    borderBottom: '1px solid #1e293b',
    paddingBottom: '1rem',
  },
  brand: { display: 'flex', alignItems: 'center', gap: '0.85rem' },
  badge: {
    backgroundColor: '#3b82f6',
    color: '#fff',
    fontSize: '0.75rem',
    fontWeight: 700,
    padding: '0.25rem 0.6rem',
    borderRadius: '999px',
  },
  title: { fontSize: '1.5rem', margin: 0, fontWeight: 700 },
  sourceToggle: {
    backgroundColor: '#1e293b',
    padding: '0.5rem 0.85rem',
    borderRadius: '0.5rem',
    fontSize: '0.85rem',
  },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' },
  mainGrid: {
    maxWidth: '1080px',
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
    gap: '1.5rem',
  },
  stageCard: {
    backgroundColor: '#1e293b',
    borderRadius: '1rem',
    padding: '1.5rem',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    border: '1px solid #334155',
  },
  mascotStage: {
    minHeight: '300px',
    backgroundColor: '#f8fafc',
    backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)',
    backgroundSize: '16px 16px',
    borderRadius: '0.75rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    position: 'relative',
  },
  stageFooter: { marginTop: '1.25rem' },
  hintText: { fontSize: '0.9rem', color: '#cbd5e1', lineHeight: 1.5, margin: '0 0 1rem 0' },
  statsRow: {
    display: 'flex',
    justifyContent: 'space-between',
    backgroundColor: '#0f172a',
    padding: '0.75rem 1rem',
    borderRadius: '0.5rem',
    fontSize: '0.85rem',
    color: '#94a3b8',
  },
  controlsCard: {
    backgroundColor: '#1e293b',
    borderRadius: '1rem',
    padding: '1.5rem',
    border: '1px solid #334155',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  sectionHeading: { fontSize: '0.95rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', margin: 0 },
  buttonGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
    gap: '0.5rem',
  },
  styleGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '0.5rem',
  },
  OptionBtn: {
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    border: '1px solid #334155',
    borderRadius: '0.5rem',
    padding: '0.6rem 0.75rem',
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  OptionBtnActive: {
    backgroundColor: '#1d4ed8',
    borderColor: '#60a5fa',
    color: '#ffffff',
  },
  sliderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    backgroundColor: '#0f172a',
    padding: '0.75rem 1rem',
    borderRadius: '0.5rem',
  },
  codeBlock: {
    backgroundColor: '#020617',
    padding: '1rem',
    borderRadius: '0.5rem',
    border: '1px solid #1e293b',
    fontSize: '0.8rem',
    color: '#38bdf8',
  },
  inspectBtn: {
    backgroundColor: '#334155',
    color: '#f8fafc',
    border: 'none',
    borderRadius: '0.5rem',
    padding: '0.75rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  sheetInspector: {
    maxWidth: '1080px',
    margin: '1.5rem auto 0 auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '1.5rem',
  },
  sheetBox: {
    backgroundColor: '#1e293b',
    padding: '1.25rem',
    borderRadius: '1rem',
    border: '1px solid #334155',
    textAlign: 'center',
  },
  sheetTitle: { margin: '0 0 0.25rem 0', fontSize: '1rem' },
  sheetSub: { margin: '0 0 1rem 0', fontSize: '0.8rem', color: '#94a3b8' },
  sheetImg: {
    width: '100%',
    maxWidth: '360px',
    backgroundColor: '#f8fafc',
    borderRadius: '0.5rem',
    border: '1px solid #475569',
  },
};

```

---

### How to Create Custom Characters (or Yourself)

In addition to the 53 pre-drawn characters, the repository includes an **Agent Skill** that generates new 3×3 aligned sprite sheets (in any of the 6 art styles or from a photo of yourself) and checks that the character's shoulders and head center don't jump between frames:

1. **Install the skill globally:**
```bash
npx skills add nilbuild/page-mascot --skill page-mascot --global --yes

```


2. **Generate via an AI coding agent** (or grab the raw prompts from `skills/page-mascot/reference/prompts.md` in the repo to use in any image generator):
```text
/page-mascot a chibi red panda wearing headphones, in the riso style
/page-mascot make one that looks like me [attach photo]

```



### Layout Pro-Tip for Headers & Hero Sections

The 1080×1080px sprite sheets leave roughly **24% transparent padding** below the character inside each square cell so the squash-and-bounce animation doesn't clip. If you want the mascot to look "perched" flush on top of a navbar border or peeking up from the bottom of a card, apply a negative bottom margin proportional to `size`:

```tsx
<div style={{ marginBottom: `-${Math.round(size * 0.24)}px`, lineHeight: 0 }}>
  <Mascot
    directions="/mascots/fox-directions.webp"
    reactions="/mascots/fox-reactions.webp"
    size={size}
  />
</div>

```