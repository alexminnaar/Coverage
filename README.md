# Screenwriter

A modern, minimalist screenwriting app with industry-standard formatting.

## Features

- **Industry-standard screenplay formatting** - Scene headings, action, character, dialogue, parentheticals, and transitions with proper margins
- **Smart auto-formatting** - Automatically detects INT./EXT. scene headings and transitions
- **Keyboard-first workflow** - Tab to cycle element types, Enter to add new elements
- **Scene navigator** - Quick jump to any scene in your screenplay
- **Page count estimation** - Real-time page count based on industry standards (~1 page/minute)
- **PDF export** - Generate properly formatted screenplay PDFs with title page
- **Auto-save** - Your work is automatically saved to browser local storage
- **Dark theme** - Writer-friendly dark UI with warm paper tones

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Tab` | Cycle element type (Action → Character → Dialogue → Parenthetical) |
| `Enter` | Create new element |
| `Backspace` | Delete empty element |
| `↑` / `↓` | Navigate between elements |

## Screenplay Element Types

- **Scene Heading** - Starts with INT. or EXT. (auto-detected)
- **Action** - Describes what happens on screen
- **Character** - Character name before dialogue
- **Dialogue** - What the character says
- **Parenthetical** - Direction within dialogue
- **Transition** - CUT TO:, FADE IN:, etc.

## Tech Stack

- React 18 + TypeScript
- Vite
- jsPDF for PDF generation
- CSS with custom properties
- Browser localStorage for persistence

