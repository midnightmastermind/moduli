// The public path list, in its own module so main.jsx can test a path without
// importing the router. Importing PromoApp.jsx here would pull react-router
// into the entry chunk for every signed-in user — the opposite of the point.
export const PROMO_PATHS = ["/features", "/examples", "/login", "/about"];
