import get from 'lodash/get';
import { mockDataFunctions } from '@usebruno/common';

const CodeMirror = require('codemirror');

const pathFoundInVariables = (path, obj) => {
  const value = get(obj, path);
  return value !== undefined;
};

/**
 * Changes the render behaviour for a given CodeMirror editor.
 * Replaces all **rendered** characters, not the actual value, with the provided character.
 */
export class MaskedEditor {
  /**
   * @param {import('codemirror').Editor} editor CodeMirror editor instance
   * @param {string} maskChar Target character being applied to all content
   */
  constructor(editor, maskChar) {
    this.editor = editor;
    this.maskChar = maskChar;
    this.enabled = false;
  }

  /**
   * Set and apply new masking character
   */
  enable = () => {
    this.enabled = true;
    this.editor.setValue(this.editor.getValue());
    this.editor.on('inputRead', this.maskContent);
    this.update();
  };

  /** Disables masking of the editor field. */
  disable = () => {
    this.enabled = false;
    this.editor.off('inputRead', this.maskContent);
    this.editor.setValue(this.editor.getValue());
  };

  /** Updates the rendered content if enabled. */
  update = () => {
    if (this.enabled) this.maskContent();
  };

  /** Replaces all rendered characters, with the provided character. */
  maskContent = () => {
    const content = this.editor.getValue();
    const lineCount = this.editor.lineCount();

    if (lineCount === 0) return;
    this.editor.operation(() => {
      // Clear previous masked text
      this.editor.getAllMarks().forEach((mark) => mark.clear());
      // Apply new masked text

      if (content.length <= 500) {
        for (let i = 0; i < content.length; i++) {
          if (content[i] !== '\n') {
            const maskedNode = document.createTextNode(this.maskChar);
            this.editor.markText(
              { line: this.editor.posFromIndex(i).line, ch: this.editor.posFromIndex(i).ch },
              { line: this.editor.posFromIndex(i + 1).line, ch: this.editor.posFromIndex(i + 1).ch },
              { replacedWith: maskedNode, handleMouseEvents: true }
            );
          }
        }
      } else {
        for (let line = 0; line < lineCount; line++) {
          const lineLength = this.editor.getLine(line).length;
          const maskedNode = document.createTextNode('*'.repeat(lineLength));
          this.editor.markText(
            { line, ch: 0 },
            { line, ch: lineLength },
            { replacedWith: maskedNode, handleMouseEvents: false }
          );
        }
      }
    });
  };
}

/**
 * Defines a custom CodeMirror mode for Bruno variables highlighting.
 * This function creates a specialized mode that can highlight both Bruno template
 * variables (in the format {{variable}}) and URL path parameters (in the format /:param).
 * 
 * @param {Object} _variables - The variables object containing data to validate against
 * @param {string} mode - The base CodeMirror mode to extend (e.g., 'javascript', 'application/json')
 * @param {boolean} highlightPathParams - Whether to highlight URL path parameters
 * @param {boolean} highlightVariables - Whether to highlight template variables
 * @returns {void} - Registers the mode with CodeMirror for later use
 */
export const defineCodeMirrorBrunoVariablesMode = (_variables, mode, highlightPathParams, highlightVariables) => {
  CodeMirror.defineMode('brunovariables', function (config, parserConfig) {
    const { pathParams = {}, ...variables } = _variables || {};
    const variablesOverlay = {
      token: function (stream) {
        if (stream.match('{{', true)) {
          let ch;
          let word = '';
          while ((ch = stream.next()) != null) {
            if (ch === '}' && stream.peek() === '}') {
              stream.eat('}');
              // Check if it's a mock variable (starts with $) and exists in mockDataFunctions
              const isMockVariable = word.startsWith('$') && mockDataFunctions.hasOwnProperty(word.substring(1));
              const found = isMockVariable || pathFoundInVariables(word, variables);
              const status = found ? 'valid' : 'invalid';
              const randomClass = `random-${(Math.random() + 1).toString(36).substring(9)}`;
              return `variable-${status} ${randomClass}`;
            }
            word += ch;
          }
        }
        stream.skipTo('{{') || stream.skipToEnd();
        return null;
      }
    };

    const urlPathParamsOverlay = {
      token: function (stream) {
        if (stream.match('/:', true)) {
          let ch;
          let word = '';
          while ((ch = stream.next()) != null) {
            if (ch === '/' || ch === '?' || ch === '&' || ch === '=') {
              stream.backUp(1);
              const found = pathFoundInVariables(word, pathParams);
              const status = found ? 'valid' : 'invalid';
              const randomClass = `random-${(Math.random() + 1).toString(36).substring(9)}`;
              return `variable-${status} ${randomClass}`;
            }
            word += ch;
          }

          // If we've consumed all characters and the word is not empty, it might be a path parameter at the end of the URL.
          if (word) {
            const found = pathFoundInVariables(word, pathParams);
            const status = found ? 'valid' : 'invalid';
            const randomClass = `random-${(Math.random() + 1).toString(36).substring(9)}`;
            return `variable-${status} ${randomClass}`;
          }
        }
        stream.skipTo('/:') || stream.skipToEnd();
        return null;
      }
    };

    let baseMode = CodeMirror.getMode(config, parserConfig.backdrop || mode);

    if (highlightVariables) {
      baseMode = CodeMirror.overlayMode(baseMode, variablesOverlay);
    }
    if (highlightPathParams) {
      baseMode = CodeMirror.overlayMode(baseMode, urlPathParamsOverlay);
    }
    return baseMode;
  });
};

export const getCodeMirrorModeBasedOnContentType = (contentType, body) => {
  if (typeof body === 'object') {
    return 'application/ld+json';
  }
  if (!contentType || typeof contentType !== 'string') {
    return 'application/text';
  }

  if (contentType.includes('json')) {
    return 'application/ld+json';
  } else if (contentType.includes('image')) {
    return 'application/image';
  } else if (contentType.includes('xml')) {
    return 'application/xml';
  } else if (contentType.includes('html')) {
    return 'application/html';
  } else if (contentType.includes('text')) {
    return 'application/text';
  } else if (contentType.includes('application/edn')) {
    return 'application/xml';
  } else if (contentType.includes('yaml')) {
    return 'application/yaml';
  } else {
    return 'application/text';
  }
};
