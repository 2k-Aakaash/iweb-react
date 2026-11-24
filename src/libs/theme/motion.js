// Motion tokens for animations run from JavaScript (Web Animations API), which take an easing
// string rather than a CSS variable: the current value of --iw-<name> (styles/tokens.css,
// overridable by a theme), or iWeb's default when it's unset.
const DEFAULTS = {
  ease: 'cubic-bezier(0.32, 0.72, 0, 1)',
  'ease-standard': 'cubic-bezier(0.4, 0, 0.2, 1)',
  'ease-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
  'ease-in': 'cubic-bezier(0.4, 0, 1, 1)',
  'ease-spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  'ease-spring-soft': 'cubic-bezier(0.34, 1.32, 0.64, 1)',
};

/** The easing for a motion token ('ease', 'ease-in', 'ease-spring'…). */
export function easing(name = 'ease') {
  if (typeof document !== 'undefined') {
    const value = getComputedStyle(document.documentElement).getPropertyValue(`--iw-${name}`).trim();
    if (value) return value;
  }
  return DEFAULTS[name] ?? DEFAULTS.ease;
}
