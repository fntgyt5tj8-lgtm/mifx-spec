export class Source {
  async getText(path) {
    throw new Error("getText not implemented");
  }

  async getJson(path) {
    return JSON.parse(await this.getText(path));
  }

  async getBlobUrl(path) {
    throw new Error("getBlobUrl not implemented");
  }

  async close() {}
}
