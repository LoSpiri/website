use wasm_bindgen::prelude::*;

fn window() -> web_sys::Window {
    web_sys::window().expect("no global window")
}

fn document() -> web_sys::Document {
    window().document().expect("no document")
}

fn local_storage() -> Option<web_sys::Storage> {
    window().local_storage().ok().flatten()
}

fn get_saved_theme() -> Option<String> {
    local_storage()?.get_item("theme").ok().flatten()
}

fn save_theme(theme: &str) {
    if let Some(storage) = local_storage() {
        let _ = storage.set_item("theme", theme);
    }
}

fn prefers_dark() -> bool {
    window()
        .match_media("(prefers-color-scheme: dark)")
        .ok()
        .flatten()
        .map(|mql| mql.matches())
        .unwrap_or(false)
}

fn current_theme() -> String {
    document()
        .document_element()
        .and_then(|el| el.get_attribute("data-theme"))
        .unwrap_or_else(|| "light".to_string())
}

fn apply_theme(theme: &str) {
    if let Some(root) = document().document_element() {
        let _ = root.set_attribute("data-theme", theme);
    }
    update_icon(theme);
}

fn update_icon(theme: &str) {
    if let Some(btn) = document().get_element_by_id("theme-toggle-btn") {
        let icon = if theme == "dark" { sun_svg() } else { moon_svg() };
        btn.set_inner_html(&icon);
    }
}

fn moon_svg() -> String {
    r#"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>"#.to_string()
}

fn sun_svg() -> String {
    r#"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>"#.to_string()
}

#[wasm_bindgen]
pub fn init_theme() {
    let theme = get_saved_theme().unwrap_or_else(|| {
        if prefers_dark() { "dark" } else { "light" }.to_string()
    });
    apply_theme(&theme);
}

#[wasm_bindgen]
pub fn toggle_theme() {
    let new_theme = if current_theme() == "dark" { "light" } else { "dark" };
    apply_theme(new_theme);
    save_theme(new_theme);
}
