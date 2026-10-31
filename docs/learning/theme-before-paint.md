# Setting the theme before the page paints

Status: **in use** (M12.8).

## 1. What it is

A small script in the server's HTML reads the visitor's theme and sets a class on `<html>` before the browser draws
anything. The design tokens in `globals.css` respond to that class.

## 2. Why it matters in Promptfolio

The server cannot know a visitor's choice, which is kept in their browser. If React set the theme, a dark-mode visitor would
see a flash of white on every load.

## 3. How it works

1. The first HTML holds the script, which runs at once: the stored choice if there is one, otherwise the system's setting.
2. React hydrates. `<html>` now has a class the server did not send, so `suppressHydrationWarning` marks that as expected.
3. The toggle chooses its icon with CSS (`dark:hidden`), not state, so its first render matches the server's.
4. A click stores the choice, and it overrides the system's setting from then on.

**The script's type differs on purpose.** Next.js also renders the tree in the browser, where React creates a script
element that never runs, and its development build warns about that. It does not warn about data blocks. So
`theme-provider.tsx` passes `type: "application/json"` in the browser and no type on the server, whose copy is the one that
runs. Hydration does not change the attribute of a script already in the page.

## 4. Where it lives in the code

- The provider: [apps/portfolio/src/components/theme/theme-provider.tsx](../../apps/portfolio/src/components/theme/theme-provider.tsx)
- The toggle: [apps/portfolio/src/components/theme/theme-toggle.tsx](../../apps/portfolio/src/components/theme/theme-toggle.tsx)
- The tokens: [apps/portfolio/src/app/globals.css](../../apps/portfolio/src/app/globals.css)
- Where it wraps the app: [apps/portfolio/src/app/layout.tsx](../../apps/portfolio/src/app/layout.tsx)

## 5. Common pitfalls and misconceptions

- **Reading the theme during render breaks hydration.** The server has no theme to read, so a component that branches on it
  renders differently in the browser. Choose with CSS, or wait until after mounting.
- **Removing `next-themes` does not remove the warning.** A hand-written script in the server layout triggered it too.
- **The warning is development-only.** It is not in React's production build, so visitors never saw it.
- **There is no test of the first paint.** It was checked by hand in a browser, and the script comes from the library.

## 6. Further reading

- [next-themes](https://github.com/pacocoursey/next-themes)
- [React: suppressHydrationWarning](https://react.dev/reference/react-dom/components/common#common-props)
- [Next.js: adding a script](https://nextjs.org/docs/app/guides/scripts)
