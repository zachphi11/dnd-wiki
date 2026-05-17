const axios = require('axios');

class WikiClient {
  constructor(baseUrl, apiToken) {
    if (!baseUrl) throw new Error('baseUrl is required');
    if (!apiToken) throw new Error('apiToken is required');
    this.graphqlUrl = `${baseUrl.trim()}/graphql`;
    this.headers = {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  async _query(query, variables = {}) {
    let response;
    try {
      response = await axios.post(
        this.graphqlUrl,
        { query, variables },
        { headers: this.headers }
      );
    } catch (err) {
      if (err.response?.status === 401) {
        throw new Error('Authentication failed: invalid or missing API token');
      }
      throw err;
    }
    if (response.data.errors) {
      const msg = response.data.errors.map(e => e.message).join('; ');
      throw new Error(`GraphQL error: ${msg}`);
    }
    return response.data.data;
  }

  async listPages() {
    const data = await this._query(`
      query {
        pages {
          list {
            id
            path
            title
          }
        }
      }
    `);
    return data.pages.list;
  }

  async getPage(id) {
    const data = await this._query(
      `query GetPage($id: Int!) {
        pages {
          single(id: $id) {
            id
            path
            title
            content
          }
        }
      }`,
      { id: parseInt(id) }
    );
    return data.pages.single ?? null;
  }

  async createPage(path, title, content) {
    const data = await this._query(
      `mutation CreatePage(
        $content: String!, $description: String!, $editor: String!,
        $isPrivate: Boolean!, $isPublished: Boolean!, $locale: String!,
        $path: String!, $tags: [String]!, $title: String!
      ) {
        pages {
          create(
            content: $content, description: $description, editor: $editor,
            isPrivate: $isPrivate, isPublished: $isPublished, locale: $locale,
            path: $path, tags: $tags, title: $title
          ) {
            responseResult { succeeded errorCode message }
            page { id path title }
          }
        }
      }`,
      {
        content, title, path,
        description: '',
        editor: 'markdown',
        isPrivate: false,
        isPublished: true,
        locale: 'en',
        tags: [],
      }
    );
    const result = data.pages.create;
    if (!result.responseResult.succeeded) {
      throw new Error(`createPage failed: ${result.responseResult.message}`);
    }
    return result.page;
  }

  async updatePage(id, content, newPath = null) {
    const page = await this.getPage(id);
    if (!page) throw new Error(`Page ${id} not found`);

    const data = await this._query(
      `mutation UpdatePage(
        $id: Int!, $content: String!, $description: String!, $editor: String!,
        $isPrivate: Boolean!, $isPublished: Boolean!, $locale: String!,
        $path: String!, $tags: [String]!, $title: String!
      ) {
        pages {
          update(
            id: $id, content: $content, description: $description, editor: $editor,
            isPrivate: $isPrivate, isPublished: $isPublished, locale: $locale,
            path: $path, tags: $tags, title: $title
          ) {
            responseResult { succeeded errorCode message }
            page { id path title }
          }
        }
      }`,
      {
        id: parseInt(id),
        content,
        description: '',
        editor: 'markdown',
        isPrivate: false,
        isPublished: true,
        locale: 'en',
        path: newPath || page.path,
        tags: [],
        title: page.title,
      }
    );
    const result = data.pages.update;
    if (!result.responseResult.succeeded) {
      throw new Error(`updatePage failed: ${result.responseResult.message}`);
    }
    return result.page;
  }
}

module.exports = WikiClient;
