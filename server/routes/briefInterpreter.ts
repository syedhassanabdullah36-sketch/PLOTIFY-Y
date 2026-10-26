/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { Request, Response } from 'express';
import { GoogleGenAI, Type } from '@google/genai';

export const briefInterpreterRouter = express.Router();

briefInterpreterRouter.post('/interpret', async (req: Request, res: Response) => {
  try {
    const { text, projectContext } = req.body || {};

    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({
        aiAvailable: false,
        error: 'A non-empty natural-language project description is required.',
        code: 'ERR_EMPTY_BRIEF_INPUT',
      });
      return;
    }

    if (text.length > 15000) {
      res.status(400).json({
        aiAvailable: false,
        error: 'Project description exceeds the maximum allowed length (15,000 characters).',
        code: 'ERR_INPUT_TOO_LARGE',
      });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      res.status(503).json({
        aiAvailable: false,
        error:
          'Server AI provider (GEMINI_API_KEY) is not configured in this environment. Falling back to deterministic local brief interpretation.',
        code: 'ERR_AI_UNAVAILABLE',
      });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey: apiKey.trim(),
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const contextHint =
      projectContext && typeof projectContext === 'object'
        ? `Existing project context (do not treat as user text overrides unless compatible): unit=${projectContext.unit || 'unspecified'}, currency=${projectContext.currency || 'unspecified'}, plotWidth=${projectContext.plotWidth || 0}, plotLength=${projectContext.plotLength || 0}.`
        : '';

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: `Analyze the following architectural project description and extract structured requirements, assumptions, and potential conflicts.\n\n${contextHint}\n\nUser Description:\n"""\n${text.trim()}\n"""`,
      config: {
        systemInstruction:
          'You are an architectural brief requirements extractor for Plotify. Extract explicit requirements and clearly separated inferred assumptions. Never silently convert an inference into a confirmed user requirement. Never invent exact regulatory code limits, structural calculations, or contractor market prices. Keep original user wording in sourceExcerpt.',
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            projectSummary: {
              type: Type.STRING,
              description: 'Concise 1-2 sentence architectural summary of the described project.',
            },
            requirements: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  category: {
                    type: Type.STRING,
                    description:
                      'One of: project-identity, occupancy-household, spaces-program, area-dimensions, floors-circulation, privacy-circulation, accessibility, daylight-ventilation, site-orientation, budget-cost, materials-sustainability, regulatory-safety, other-unclassified',
                  },
                  description: { type: Type.STRING },
                  normalizedValue: { type: Type.STRING },
                  unit: { type: Type.STRING },
                  priority: {
                    type: Type.STRING,
                    description: 'One of: must-have, preferred, optional',
                  },
                  source: {
                    type: Type.STRING,
                    description: 'One of: explicit, inferred',
                  },
                  confidence: {
                    type: Type.STRING,
                    description: 'One of: high, medium, low',
                  },
                  sourceExcerpt: { type: Type.STRING },
                  clarificationQuestion: { type: Type.STRING },
                  quantity: { type: Type.INTEGER },
                  floorPreference: { type: Type.STRING },
                },
                required: [
                  'id',
                  'category',
                  'description',
                  'normalizedValue',
                  'priority',
                  'source',
                  'confidence',
                ],
              },
            },
            assumptions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  category: { type: Type.STRING },
                  description: { type: Type.STRING },
                  assumedValue: { type: Type.STRING },
                  unit: { type: Type.STRING },
                  rationale: { type: Type.STRING },
                },
                required: ['id', 'category', 'description', 'assumedValue', 'rationale'],
              },
            },
          },
          required: ['projectSummary', 'requirements', 'assumptions'],
        },
      },
    });

    const rawJson = response.text ? response.text.trim() : '';
    if (!rawJson) {
      res.status(502).json({
        aiAvailable: false,
        error: 'AI provider returned an empty response.',
        code: 'ERR_AI_EMPTY_RESPONSE',
      });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      res.status(502).json({
        aiAvailable: false,
        error: 'AI provider returned malformed JSON output.',
        code: 'ERR_AI_MALFORMED_OUTPUT',
      });
      return;
    }

    res.json({
      aiAvailable: true,
      payload: parsed,
    });
  } catch (err: any) {
    console.error('[Brief Interpreter AI Route]:', err?.message || err);
    res.status(503).json({
      aiAvailable: false,
      error: 'AI interpretation service encountered an error or is unavailable.',
      code: 'ERR_AI_SERVICE_FAILURE',
    });
  }
});
