export class PlatformClient {
  constructor(secret) {
    this.secret = secret;
  }
  async callApi(endpoint, method, body) {
    return {};
  }
}