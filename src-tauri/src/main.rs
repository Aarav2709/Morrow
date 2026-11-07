// no console window next to the app on windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    morrow_lib::run()
}
