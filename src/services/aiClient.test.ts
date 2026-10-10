import { describe, expect, it, vi } from 'vitest';
import { generateStoryboardImage, parseAIStreamData } from './aiClient';

describe('parseAIStreamData', () => {
  it('preserves typed final events so streamed text is replaced, not appended', () => {
    const event = parseAIStreamData(JSON.stringify({
      type: 'final',
      content: 'The completed answer.',
    }));

    expect(event).toEqual({
      type: 'final',
      content: 'The completed answer.',
    });
  });

  it('unwraps legacy content envelopes', () => {
    const event = parseAIStreamData(JSON.stringify({
      content: JSON.stringify({ type: 'text_delta', content: 'Hello' }),
    }));

    expect(event).toEqual({ type: 'text_delta', content: 'Hello' });
  });

  it('keeps legacy plain-text envelopes working', () => {
    const event = parseAIStreamData(JSON.stringify({ content: 'Hello' }));

    expect(event).toBe('Hello');
  });

  it('preserves typed Outline mode beat operations', () => {
    const event = parseAIStreamData(JSON.stringify({
      type: 'final',
      beatOps: {
        ops: [{
          op: 'create',
          actIndex: 0,
          beat: { title: 'Inciting incident', description: 'The story changes direction.' },
        }],
      },
    }));

    expect(event).toMatchObject({
      type: 'final',
      beatOps: {
        ops: [{ op: 'create', actIndex: 0 }],
      },
    });
  });

  it('preserves outline operations emitted immediately after the tool succeeds', () => {
    const event = parseAIStreamData(JSON.stringify({
      type: 'outline_ops_ready',
      beatOps: {
        ops: [{
          op: 'set_treatment',
          treatment: 'A complete treatment.',
        }],
      },
    }));

    expect(event).toMatchObject({
      type: 'outline_ops_ready',
      beatOps: {
        ops: [{ op: 'set_treatment' }],
      },
    });
  });

  it('preserves storyboard operations emitted immediately after the tool succeeds', () => {
    const event = parseAIStreamData(JSON.stringify({
      type: 'storyboard_ops_ready',
      storyboardOps: {
        ops: [{
          op: 'replace',
          sceneId: 'scene-1',
          shots: [{
            title: 'Establishing',
            shotType: 'Wide shot',
            action: 'Rain falls over the empty street.',
            characters: [],
          }],
        }],
      },
    }));

    expect(event).toMatchObject({
      type: 'storyboard_ops_ready',
      storyboardOps: {
        ops: [{ op: 'replace', sceneId: 'scene-1' }],
      },
    });
  });

  it('requests one storyboard image from the AI service', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        url: 'https://images.example.com/panel.png',
        providerAssetId: 'storyboards/project/scene/panel.png',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await generateStoryboardImage({
      projectId: 'project',
      sceneId: 'scene',
      shotId: 'shot',
      prompt: 'A wide shot of an empty street.',
      style: 'Charcoal sketch',
      aspectRatio: '16:9',
    });

    expect(result.url).toContain('panel.png');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/storyboard/generate-image'),
      expect.objectContaining({ method: 'POST' }),
    );
    fetchMock.mockRestore();
  });
});
