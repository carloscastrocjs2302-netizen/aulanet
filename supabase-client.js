// =====================================================================
// AULANET · CLIENTE DE SUPABASE
// =====================================================================
// Se carga después del SDK de Supabase (via CDN) y de config.js.
// Expone `window.sb` para usar en toda la app.
// =====================================================================

window.sb = supabase.createClient(AULANET_CONFIG.SUPABASE_URL, AULANET_CONFIG.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
