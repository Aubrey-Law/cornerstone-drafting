/**
 * The manifest requires a FunctionFile even when no ribbon control runs a
 * function directly. Every command today is "show the task pane", which Office
 * handles itself, so this file only needs to exist and initialize.
 */
Office.onReady(() => {})
