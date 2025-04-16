// src/polyfills.ts

/**
 * Ensures the JavaScript environment has necessary polyfills
 * for the plugin to work properly
 */
export function ensureEnvironment() {
    try {
      // Log initialization
      if (typeof Zotero !== 'undefined') {
        Zotero.debug("[LibrarySearch] Initializing environment polyfills");
      }
      
      // Ensure console methods exist - use type guards properly
      if (typeof console !== 'undefined') {
        if (!console.trace) {
          (console as any).trace = function(...args: any[]) {
            if (console.log) console.log('[TRACE]', ...args);
          };
        }
        
        if (!console.group) {
          (console as any).group = function(...args: any[]) {
            if (console.log) console.log('[GROUP]', ...args);
          };
        }
        
        if (!console.groupEnd) {
          (console as any).groupEnd = function() {
            if (console.log) console.log('[GROUP END]');
          };
        }
        
        if (!console.groupCollapsed) {
          (console as any).groupCollapsed = function(...args: any[]) {
            if (console.log) console.log('[GROUP COLLAPSED]', ...args);
          };
        }
      }
      
      // For window-specific polyfills, only run them if we're in a window context
      if (typeof Zotero !== 'undefined' && typeof Zotero.getMainWindow === 'function') {
        const mainWindow = Zotero.getMainWindow();
        
        if (mainWindow) {
          // Ensure window2 exists on the main window
          if (!(mainWindow as any).window2) {
            Object.defineProperty(mainWindow, 'window2', {
              get: () => mainWindow,
              configurable: true
            });
            
            if (typeof Zotero !== 'undefined') {
              Zotero.debug("[LibrarySearch] Added window2 reference to main window");
            }
          }
          
          // For globalThis polyfills, we need to handle browser compatibility
          if (typeof globalThis !== 'undefined') {
            const global = globalThis as any;
            
            if (!global.addEventListener && mainWindow.addEventListener) {
              global.addEventListener = function(
                type: string, 
                listener: EventListenerOrEventListenerObject, 
                options?: boolean | AddEventListenerOptions
              ) {
                mainWindow.addEventListener(type, listener, options);
              };
              
              if (typeof Zotero !== 'undefined') {
                Zotero.debug("[LibrarySearch] Added addEventListener to globalThis");
              }
            }
            
            if (!global.removeEventListener && mainWindow.removeEventListener) {
              global.removeEventListener = function(
                type: string, 
                listener: EventListenerOrEventListenerObject, 
                options?: boolean | EventListenerOptions
              ) {
                mainWindow.removeEventListener(type, listener, options);
              };
              
              if (typeof Zotero !== 'undefined') {
                Zotero.debug("[LibrarySearch] Added removeEventListener to globalThis");
              }
            }
            
            if (!global.dispatchEvent && mainWindow.dispatchEvent) {
              global.dispatchEvent = function(event: Event) {
                return mainWindow.dispatchEvent(event);
              };
              
              if (typeof Zotero !== 'undefined') {
                Zotero.debug("[LibrarySearch] Added dispatchEvent to globalThis");
              }
            }
            
            // Define _console for the toolkit
            if (global._console === undefined) {
              global._console = console;
              
              if (typeof Zotero !== 'undefined') {
                Zotero.debug("[LibrarySearch] Added _console reference to globalThis");
              }
            }
          }
          
          // Handle _globalThis if it exists (used in the template)
          if (typeof _globalThis !== 'undefined') {
            const global = _globalThis as any;
            
            if (!global.addEventListener && mainWindow.addEventListener) {
              global.addEventListener = function(
                type: string, 
                listener: EventListenerOrEventListenerObject, 
                options?: boolean | AddEventListenerOptions
              ) {
                mainWindow.addEventListener(type, listener, options);
              };
              
              if (typeof Zotero !== 'undefined') {
                Zotero.debug("[LibrarySearch] Added addEventListener to _globalThis");
              }
            }
            
            if (!global.removeEventListener && mainWindow.removeEventListener) {
              global.removeEventListener = function(
                type: string, 
                listener: EventListenerOrEventListenerObject, 
                options?: boolean | EventListenerOptions
              ) {
                mainWindow.removeEventListener(type, listener, options);
              };
              
              if (typeof Zotero !== 'undefined') {
                Zotero.debug("[LibrarySearch] Added removeEventListener to _globalThis");
              }
            }
            
            if (!global.dispatchEvent && mainWindow.dispatchEvent) {
              global.dispatchEvent = function(event: Event) {
                return mainWindow.dispatchEvent(event);
              };
              
              if (typeof Zotero !== 'undefined') {
                Zotero.debug("[LibrarySearch] Added dispatchEvent to _globalThis");
              }
            }
            
            // Define _console for the toolkit
            if (global._console === undefined) {
              global._console = console;
              
              if (typeof Zotero !== 'undefined') {
                Zotero.debug("[LibrarySearch] Added _console reference to _globalThis");
              }
            }
          }
        } else if (typeof Zotero !== 'undefined') {
          Zotero.debug("[LibrarySearch] Could not get main window, some polyfills might not work");
        }
      }
      
      if (typeof Zotero !== 'undefined') {
        Zotero.debug("[LibrarySearch] Environment polyfills initialized successfully");
      }
    } catch (e) {
      // Safe fallback if anything goes wrong with polyfills
      if (typeof Zotero !== 'undefined') {
        Zotero.debug("[LibrarySearch] Error in polyfills: " + e);
      } else if (typeof console !== 'undefined' && console.error) {
        console.error("[LibrarySearch] Error in polyfills:", e);
      }
    }
  }