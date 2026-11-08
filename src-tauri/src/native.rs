// what each system's webview does its own way: printing a page to pdf, a picture of the window, spelling
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{Runtime, WebviewWindow};
use tokio::sync::oneshot;

pub type Res<T> = Result<T, String>;

// linux and windows print a page straight into a pdf file, the other systems go through the print dialog
pub const PRINTS_TO_FILE: bool = cfg!(any(target_os = "linux", windows));
// and those two can take a picture of the window
pub const CAPTURES: bool = cfg!(any(target_os = "linux", windows));

// 2026-11-10T08-41-00-123Z, the moment as a backup's name, sorting in time order
pub fn iso_stamp() -> String {
    let ms = crate::paths::now_ms();
    let (secs, millis) = (ms / 1000, ms % 1000);
    let days = (secs / 86_400) as i64;
    let rest = secs % 86_400;
    // days since 1970 to a calendar date, howard hinnant's method
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}-{:02}-{:02}-{millis:03}Z",
        rest / 3600,
        rest / 60 % 60,
        rest % 60
    )
}

// a channel whose sender can be handed to callbacks that may be called more than once
fn once<T: Send + 'static>() -> (impl Fn(T) + Clone + Send + 'static, oneshot::Receiver<T>) {
    let (send, receive) = oneshot::channel();
    let slot = Arc::new(Mutex::new(Some(send)));
    let fire = move |value: T| {
        if let Some(send) = slot.lock().ok().and_then(|mut slot| slot.take()) {
            let _ = send.send(value);
        }
    };
    (fire, receive)
}

// the part of a picture of the whole window that the page asked for. the page measures in its own pixels,
// which zooming and the screen's scale make larger or smaller, so it says how wide it is in those
pub fn crop_png(png: &[u8], area: [f64; 4], viewport_width: f64) -> Res<Vec<u8>> {
    let image = image::load_from_memory(png).map_err(|error| error.to_string())?;
    let scale = if viewport_width > 0.0 {
        f64::from(image.width()) / viewport_width
    } else {
        1.0
    };
    let [x, y, width, height] = area.map(|value| (value * scale).round().max(0.0) as u32);
    let x = x.min(image.width().saturating_sub(1));
    let y = y.min(image.height().saturating_sub(1));
    let width = width.min(image.width() - x).max(1);
    let height = height.min(image.height() - y).max(1);
    let mut out = std::io::Cursor::new(Vec::new());
    image
        .crop_imm(x, y, width, height)
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(out.into_inner())
}

#[cfg(target_os = "linux")]
pub fn setup_webview<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.with_webview(|webview| {
        use webkit2gtk::{WebContextExt, WebViewExt};
        let Some(context) = webview.inner().context() else {
            return;
        };
        // webkitgtk leaves spelling off, it is checked in the languages this computer is set to
        let mut languages: Vec<String> = ["LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"]
            .iter()
            .filter_map(|name| std::env::var(name).ok())
            .flat_map(|value| value.split(':').map(String::from).collect::<Vec<_>>())
            .map(|value| value.split('.').next().unwrap_or_default().to_string())
            .filter(|value| !value.is_empty() && value != "C" && value != "POSIX")
            .collect();
        languages.dedup();
        if languages.is_empty() {
            languages.push("en_US".into());
        }
        let refs: Vec<&str> = languages.iter().map(String::as_str).take(3).collect();
        context.set_spell_checking_languages(&refs);
        context.set_spell_checking_enabled(true);
    });
}

#[cfg(target_os = "linux")]
pub async fn print_to_pdf<R: Runtime>(window: &WebviewWindow<R>, path: &Path) -> Res<()> {
    let uri = url::Url::from_file_path(path)
        .map_err(|_| "Invalid path.".to_string())?
        .to_string();
    let (done, receive) = once::<Res<()>>();
    window
        .with_webview(move |webview| {
            use webkit2gtk::{PrintOperation, PrintOperationExt};
            let operation = PrintOperation::new(&webview.inner());
            let settings = gtk::PrintSettings::new();
            settings.set_printer("Print to File");
            settings.set("output-uri", Some(&uri));
            settings.set("output-file-format", Some("pdf"));
            let page = gtk::PageSetup::new();
            page.set_paper_size(&gtk::PaperSize::new(Some(&gtk::PAPER_NAME_A4)));
            for set in [
                gtk::PageSetup::set_top_margin,
                gtk::PageSetup::set_bottom_margin,
                gtk::PageSetup::set_left_margin,
                gtk::PageSetup::set_right_margin,
            ] {
                set(&page, 0.6, gtk::Unit::Inch);
            }
            operation.set_print_settings(&settings);
            operation.set_page_setup(&page);
            let finished = done.clone();
            operation.connect_finished(move |_| finished(Ok(())));
            let failed = done.clone();
            operation.connect_failed(move |_, error| failed(Err(error.to_string())));
            operation.print();
        })
        .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

#[cfg(target_os = "linux")]
pub async fn capture<R: Runtime>(
    window: &WebviewWindow<R>,
    area: [f64; 4],
    viewport_width: f64,
) -> Res<Vec<u8>> {
    let (done, receive) = once::<Res<Vec<u8>>>();
    window
        .with_webview(move |webview| {
            use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};
            webview.inner().snapshot(
                SnapshotRegion::Visible,
                SnapshotOptions::NONE,
                None::<&gtk::gio::Cancellable>,
                move |result| {
                    let png = result
                        .map_err(|error| error.to_string())
                        .and_then(|surface| {
                            let mut bytes = Vec::new();
                            cairo::ImageSurface::try_from(surface)
                                .map_err(|_| "The picture could not be made.".to_string())?
                                .write_to_png(&mut bytes)
                                .map_err(|error| error.to_string())?;
                            Ok(bytes)
                        });
                    done(png);
                },
            );
        })
        .map_err(|error| error.to_string())?;
    let png = receive.await.map_err(|error| error.to_string())??;
    crop_png(&png, area, viewport_width)
}

#[cfg(windows)]
pub fn setup_webview<R: Runtime>(_window: &WebviewWindow<R>) {}

#[cfg(windows)]
pub async fn print_to_pdf<R: Runtime>(window: &WebviewWindow<R>, path: &Path) -> Res<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_7,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows_core::{Interface, HSTRING};
    let target = HSTRING::from(path.as_os_str());
    let (done, receive) = once::<Res<()>>();
    window
        .with_webview(move |webview| {
            let result = (|| -> windows_core::Result<()> {
                let controller = webview.controller();
                let core = unsafe { controller.CoreWebView2()? }.cast::<ICoreWebView2_7>()?;
                let environment = webview.environment().cast::<ICoreWebView2Environment6>()?;
                let settings = unsafe { environment.CreatePrintSettings()? };
                unsafe {
                    // a4 in inches, with the same margins as before, and backgrounds such as table headers
                    settings.SetPageWidth(8.27)?;
                    settings.SetPageHeight(11.69)?;
                    settings.SetMarginTop(0.6)?;
                    settings.SetMarginBottom(0.6)?;
                    settings.SetMarginLeft(0.6)?;
                    settings.SetMarginRight(0.6)?;
                    settings.SetShouldPrintBackgrounds(true)?;
                    settings.SetShouldPrintHeaderAndFooter(false)?;
                }
                let finished = done.clone();
                let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, ok| {
                    finished(match (result, ok) {
                        (Ok(()), true) => Ok(()),
                        (Err(error), _) => Err(error.message().to_string()),
                        _ => Err("The PDF could not be saved.".into()),
                    });
                    Ok(())
                }));
                unsafe { core.PrintToPdf(&target, &settings, &handler) }
            })();
            if let Err(error) = result {
                done(Err(error.message().to_string()));
            }
        })
        .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

#[cfg(windows)]
pub async fn capture<R: Runtime>(
    window: &WebviewWindow<R>,
    area: [f64; 4],
    viewport_width: f64,
) -> Res<Vec<u8>> {
    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
    use windows::Win32::System::Com::{IStream, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};
    use windows::Win32::UI::Shell::SHCreateMemStream;
    let (done, receive) = once::<Res<Vec<u8>>>();
    window
        .with_webview(move |webview| {
            let result = (|| -> windows_core::Result<()> {
                let core = unsafe { webview.controller().CoreWebView2()? };
                let stream: IStream = unsafe { SHCreateMemStream(None) }
                    .ok_or_else(windows_core::Error::from_thread)?;
                let reading = stream.clone();
                let finished = done.clone();
                let handler = CapturePreviewCompletedHandler::create(Box::new(move |result| {
                    let bytes = result.and_then(|()| unsafe {
                        let mut stat = STATSTG::default();
                        reading.Stat(&mut stat, STATFLAG_NONAME)?;
                        reading.Seek(0, STREAM_SEEK_SET, None)?;
                        let mut data = vec![0u8; stat.cbSize as usize];
                        let mut read = 0u32;
                        reading
                            .Read(data.as_mut_ptr().cast(), data.len() as u32, Some(&mut read))
                            .ok()?;
                        data.truncate(read as usize);
                        Ok(data)
                    });
                    finished(bytes.map_err(|error| error.message().to_string()));
                    Ok(())
                }));
                unsafe {
                    core.CapturePreview(
                        COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                        &stream,
                        &handler,
                    )
                }
            })();
            if let Err(error) = result {
                done(Err(error.message().to_string()));
            }
        })
        .map_err(|error| error.to_string())?;
    let png = receive.await.map_err(|error| error.to_string())??;
    crop_png(&png, area, viewport_width)
}

// macos, android and ios: the system's own print dialog, which saves as pdf too
#[cfg(not(any(target_os = "linux", windows)))]
pub fn setup_webview<R: Runtime>(_window: &WebviewWindow<R>) {}

#[cfg(not(any(target_os = "linux", windows)))]
pub async fn print_to_pdf<R: Runtime>(_window: &WebviewWindow<R>, _path: &Path) -> Res<()> {
    Err("Printing to a file is not available on this system.".into())
}

#[cfg(not(any(target_os = "linux", windows)))]
pub async fn capture<R: Runtime>(
    _window: &WebviewWindow<R>,
    _area: [f64; 4],
    _viewport_width: f64,
) -> Res<Vec<u8>> {
    Err("Saving a picture of the canvas is not available on this system yet.".into())
}

#[cfg(test)]
mod tests {
    #[test]
    fn stamps_sort_in_time_order() {
        let stamp = super::iso_stamp();
        assert_eq!(stamp.len(), "2026-11-10T08-41-00-123Z".len());
        assert!(stamp.starts_with("20"));
    }
}
