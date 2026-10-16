# 🦊 Mascot Playground & Studio

> An interactive web playground and avatar generator for cursor-tracking 3×3 sprite page mascots with physics-driven reactions, art styles, and 18-sticker chat export.

[![React](https://img.shields.io/badge/React-18.x-61dafb?style=flat&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat&logo=typescript)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8.x-646cff?style=flat&logo=vite)](https://vitejs.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## ✨ Features

- **🎯 8-Way Cursor Tracking:** Real-time gaze tracking with 70px circular dead-zone hysteresis to eliminate jitter and give the mascot an organic, lifelike presence.
- **💥 Interactive Poke & Reaction Physics:** Rapid-click combo counter, squash-and-stretch CSS keyframe physics, and 9 expressive reactions (*Blink, Heart Eyes, Sparkles, Surprised, Wink, Bashful, Sleepy, Dizzy @_@, and Delighted*).
- **📸 Client-Side Photo Lab & Sticker Rig:** Turn any solo portrait into an authentic WhatsApp/Telegram die-cut sticker bust. Features automated image validation (resolution, brightness, Laplacian sharpness), natural bust contour cutout, cel-shaded color balancing, white die-cut borders, and ambient drop shadows.
- **🎨 6 Visual Art Styles:** Switch between `Colour`, `Ink`, `Sketch`, `Riso` (risograph print), `Paper` (cut-paper craft), and `Pixel` (retro 32px sprites). Native artist-drawn sheets for Fox with instant GPU shader fallbacks for all other mascots and custom uploads.
- **📦 18-Sticker WhatsApp / Telegram Pack Exporter:** Slice 3×3 sprite sheets into 512×512 transparent WebP stickers. Download individual stickers or bundle all 18 into a formatted `.zip` archive ready for messaging apps or Discord custom emojis.
- **🛠️ Props Tuner & Live Code Snippet Generator:** Tune dimensions (80px – 320px), toggle perch mode (half-body bottom shelf docking), audio feedback, and copy drop-in JSX integration code.
- **🔍 3×3 Sprite Atlas Inspector:** Frame-by-frame grid inspector with coordinate crosshairs and hover telemetry.

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- `npm` or `pnpm`

### Installation

```bash
# Clone the repository
git clone https://github.com/imVVerma/Trying-Page-Mascot.git
cd Trying-Page-Mascot

# Install dependencies
npm install

# Start local development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) (or the port indicated in your terminal) in your browser.

### Production Build

```bash
npm run build
npm run preview
```

---

## 📁 Project Structure

```
Trying-Page-Mascot/
├── public/
│   ├── favicon.svg             # Custom branded watcher mascot vector icon
│   ├── icons.svg               # SVG sprite definitions
│   └── mascots/                # Official local 3x3 sprite sheets (Fox 6 styles)
├── src/
│   ├── components/
│   │   └── EnhancedMascot.tsx  # Enhanced cursor tracker, squash physics & audio
│   ├── utils/
│   │   ├── photoValidator.ts   # Laplacian variance & luminance photo validator
│   │   ├── proceduralSpriteGenerator.ts # Die-cut sticker synthesizer & 3x3 atlas rig
│   │   └── stickerSlicer.ts    # 512x512 WebP slicer, style filter & ZIP packager
│   ├── App.tsx                 # Studio navigation, playground & reactive controls
│   ├── App.css                 # Dark mode glassmorphic UI design system
│   └── main.tsx                # App entry point
├── index.html
├── package.json
└── README.md
```

---

## 🎨 3×3 Sprite Sheet Specification

Each mascot consists of two 3×3 sprite atlases (usually 1080×1080px or 768×768px):

1. **Directions Sheet (`*-directions.webp`):**
   - Row 0: `Up-Left` | `Up` | `Up-Right`
   - Row 1: `Left` | `Center (Neutral)` | `Right`
   - Row 2: `Down-Left` | `Down` | `Down-Right`

2. **Reactions Sheet (`*-reactions.webp`):**
   - Row 0: `Blink` | `Heart Eyes` | `Sparkle`
   - Row 1: `Surprised` | `Wink` | `Bashful`
   - Row 2: `Sleepy` | `Dizzy` | `Delighted`

---

## 🤝 Acknowledgements & Credits

- Core concept and original mascot artwork inspired by [`page-mascot`](https://github.com/kamranahmedse/page-mascot) by [Kamran Ahmed](https://github.com/kamranahmedse).
- Icons provided by [Lucide React](https://lucide.dev/).
- Confetti effects powered by [canvas-confetti](https://github.com/catdad/canvas-confetti).
- Zip archiving powered by [JSZip](https://stuk.github.io/jszip/).

---

## 📄 License

This project is open-source and released under the [MIT License](LICENSE).
