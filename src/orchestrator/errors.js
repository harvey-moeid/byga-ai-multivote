/**
 * Error konfigurasi/pra-syarat analisis (bukan kegagalan runtime provider).
 *
 * Dilempar SEBELUM ada call ke provider AI dan sebelum ada baris yang
 * disimpan ke D1, sehingga pemanggil (functions/api/analyze.js) bisa
 * membalas 422 dengan pesan yang jelas alih-alih menyimpan analisis kosong.
 */
export class AnalysisConfigError extends Error {
  constructor(message, { code = "ANALYSIS_CONFIG_ERROR", details = {} } = {}) {
    super(message);
    this.name = "AnalysisConfigError";
    this.error_code = code;
    this.details = details;
  }
}
