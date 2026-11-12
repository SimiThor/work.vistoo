/**
 * Appearance (light/dark). The choice is per browser (localStorage), default
 * "system". The `<html>` element carries class `dark` or `light`; the colour
 * tokens (tokens.generated.css) and Tailwind's `dark:` variant read it.
 * Without JavaScript the CSS falls back to the system setting.
 */
export const THEME_STORAGE_KEY = "vistoo:theme";
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABEL: Record<Theme, string> = { system: "System", light: "Hell", dark: "Dunkel" };

/** Browser chrome colour (Safari tab bar, Android status bar) per resolved appearance. */
export const THEME_COLOR = { light: "#ffffff", dark: "#1c1c1e" } as const;

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** Sets the class on <html> (and the colour of the browser chrome) for `theme`. */
export function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.setAttribute("content", dark ? THEME_COLOR.dark : THEME_COLOR.light);
  });
}

/**
 * Runs inline in <head> before the first paint, so a dark page never flashes
 * white, and follows changes of the system setting for the whole page life
 * while "system" is chosen. Self-contained (no imports), mirrors readTheme/applyTheme.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)},m=window.matchMedia("(prefers-color-scheme: dark)");function a(){var t=null;try{t=localStorage.getItem(k)}catch(e){}var d=t==="dark"||(t!=="light"&&m.matches),c=document.documentElement.classList;c.toggle("dark",d);c.toggle("light",!d);}a();m.addEventListener("change",function(){var t=null;try{t=localStorage.getItem(k)}catch(e){}if(t!=="light"&&t!=="dark")a();});}catch(e){}})();`;
