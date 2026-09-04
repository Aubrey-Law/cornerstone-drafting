import '@testing-library/jest-dom/vitest'

/**
 * jsdom implements no layout, so `Element.prototype.scrollIntoView` does not
 * exist. Any component that calls it — keeping a selected citation on screen,
 * for instance — throws a TypeError from inside its effect, which vitest
 * surfaces as an unhandled error and sometimes as a failed file.
 *
 * A no-op is the honest stand-in: there is no viewport here, so there is
 * nothing to assert about scrolling. A test that cared which block was on
 * screen would have to spy on this itself.
 */
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}
