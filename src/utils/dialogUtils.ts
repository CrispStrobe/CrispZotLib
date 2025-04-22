// src/utils/dialogUtils.ts

import { ThemeUtils } from "../modules/themeUtils"; 

// Logger helper (define or import if needed)
const log = (msg: string, level: 'log' | 'warn' | 'error' = 'log') => {
    const prefix = "[LibrarySearch]";
    const logger = _globalThis.ztoolkit?.log || _globalThis.console?.log || Zotero?.debug;
    if (typeof logger === 'function') {
        logger(`${prefix} [${level.toUpperCase()}] ${msg}`);
    } else {
        console.log(`${prefix} [${level.toUpperCase()}] ${msg}`);
    }
};

/**
 * Enhanced dialog creation with proper styling.
 * Applies common styling and structure for the plugin's dialogs.
 * @param rows Number of grid rows
 * @param cols Number of grid columns
 * @returns Dialog helper instance with overridden open method
 */
export function createStyledDialog(rows: number, cols: number): any {
    // Create the dialog helper using 'any' to avoid ZoteroToolkit type issues if not fully typed
    const dialogHelper: any = new ztoolkit.Dialog(rows, cols);

    // Store the original open method
    const originalOpen = dialogHelper.open;

    // Override the open method to inject styles and structure
    dialogHelper.open = function(title: string, windowFeatures?: any) {
        // Call the original open method first
        const result = originalOpen.call(this, title, windowFeatures);

        try {
            // Check if a window was successfully created
            if (result && result.window) {
                const win = result.window;

                if (win.document) {
                    // Apply dark mode theme based on Zotero's setting
                    ThemeUtils.applyTheme(win);

                    const doc = win.document;
                    if (doc.body) {
                        // Add a general class for dialog styling
                        doc.body.classList.add('librarysearch-dialog');

                        // --- Add a container div for better structure and styling ---
                        const container = doc.createElement('div');
                        container.className = 'dialog-container';

                        // Move all direct children of body into the container
                        while (doc.body.childNodes.length > 0) {
                            container.appendChild(doc.body.childNodes[0]);
                        }
                        doc.body.appendChild(container); // Append the container back to the body

                        // --- Style the H1 header ---
                        const h1Elements = container.getElementsByTagName('h1'); // Search within container
                        if (h1Elements.length > 0 && h1Elements[0].parentNode) {
                            const headerDiv = doc.createElement('div');
                            headerDiv.className = 'dialog-header';
                            // Insert the headerDiv before the h1, then move h1 into it
                            h1Elements[0].parentNode.insertBefore(headerDiv, h1Elements[0]);
                            headerDiv.appendChild(h1Elements[0]);
                        }

                        // --- Style and group buttons ---
                        const buttons = container.querySelectorAll('button'); // Search within container
                        if (buttons.length > 0) {
                            // Find or create a button container div
                            let buttonContainer = container.querySelector('.button-container');
                            if (!buttonContainer) {
                                buttonContainer = doc.createElement('div');
                                buttonContainer.className = 'button-container';

                                // Append the button container at the end of the main container
                                container.appendChild(buttonContainer);
                            }

                            // Move buttons into the container and apply primary style
                            buttons.forEach((button: HTMLButtonElement) => {
                                // Only move if not already in the container
                                if (button.parentNode !== buttonContainer) {
                                    buttonContainer!.appendChild(button); // Use non-null assertion
                                }

                                // Add 'primary' class to common action buttons
                                if (button.id === 'search' || button.id === 'import' ||
                                    button.id === 'importAll' ||
                                    (button.textContent && button.textContent.includes('Search'))) { // Check text content as fallback
                                    button.classList.add('primary');
                                }
                            });
                        }
                    }
                }
            }
        } catch (e: any) {
            log(`Error applying styles in createStyledDialog: ${e.message}`, 'error');
            // Don't prevent the dialog from opening, just log the styling error
        }

        // Return the original result (the dialog instance)
        return result;
    };

    // Return the modified dialog helper
    return dialogHelper;
}