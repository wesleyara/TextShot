# Changelog

All notable changes to TextShot. The project follows [semantic versioning](https://semver.org).

## [Unreleased]

### Added
- **capture:** select an area with Super+Shift+T (configurable), recognize its text with Tesseract and copy it to the clipboard
- **capture:** works on Wayland and X11 without a screenshot permission prompt; Esc or right click cancels
- **ocr:** active languages in priority order, text layout (page segmentation) and upscaling of small selections
- **deps:** install Tesseract and language packs with one click through PackageKit (Debian/Ubuntu, Fedora, Arch)
- **prefs:** download and uninstall any of the 100+ Tesseract languages
- **prefs:** storage page with the disk usage of the extension, OCR engine, each language and the history
- **panel:** top bar menu with history, quick language toggles and settings
- **i18n:** interface in English, Português (Brasil), Español, Deutsch, Italiano and 中文（简体）
