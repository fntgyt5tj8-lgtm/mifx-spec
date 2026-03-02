import { Source } from "./source.js";

export class ZipSource extends Source {
  constructor(zip) {
    super();
    this.zip = zip;
    this._urls = [];
  }

  static async fromFile(file) {
    const JSZip = window.JSZip;
    if (!JSZip) throw new Error("JSZip not loaded. Add it to index.html first.");
    const zip = await JSZip.loadAsync(file); // File is a Blob -> OK
    return new ZipSource(zip);
  }

  // Keep your existing API if you like
  async getText(path) {
    const f = this.zip.file(path);
    if (!f) throw new Error("Missing: " + path);
    return await f.async("string"); // <- use "string"
  }

  // Add this to satisfy the rest of the codebase
  async readText(path) {
    return await this.getText(path);
  }

  async getBlobUrl(path) {
    const f = this.zip.file(path);
    if (!f) return null;
    const blob = await f.async("blob");
    const url = URL.createObjectURL(blob);
    this._urls.push(url);
    return url;
  }

  async close() {
    this._urls.forEach(u => URL.revokeObjectURL(u));
    this._urls = [];
  }
}