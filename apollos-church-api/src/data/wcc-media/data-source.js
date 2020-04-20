import { RESTDataSource } from 'apollo-datasource-rest';
import { createCursor, parseCursor } from '@apollosproject/server-core';

import { ApolloError } from 'apollo-server';
import { get, values } from 'lodash';

import { resolver as seriesResolver } from '../wcc-series';

class dataSource extends RESTDataSource {
  baseURL = 'https://media.watermark.org/api/v1/messages';

  async getFromId(id) {
    const result = await this.get(id);
    if (
      !result ||
      typeof result !== 'object' ||
      result.error ||
      !result.message
    )
      throw new ApolloError(result?.error?.message, result?.error?.code);
    return result.message;
  }

  getFeatures({ speakers }) {
    const speakerFeatures = speakers.map(
      this.context.dataSources.Feature.createSpeakerFeature
    );

    return [...speakerFeatures];
  }

  getVideoThumbnailUrl = (youtube) => {
    // first, Watermark's Youtube URLs seem to be misformatted. Fix that:
    const fixedUrl = youtube.replace('?rel=0', '');
    const url = new URL(fixedUrl);
    const videoId = url.searchParams.get('v');
    if (!videoId) return null;
    return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  };

  async getSpeakerByName({ name }) {
    const { Search } = this.context.dataSources;
    const results = await Search.byPaginatedQuery({
      index: Search.peopleIndex,
      query: name,
      facets: ['*'],
    });
    return results[0];
  }

  async paginate({
    filters = {},
    pagination: { after, first = 20 } = {},
  } = {}) {
    // used to build the params sent to /messages endpoint
    let requestParams = { ...filters };
    requestParams.limit = first;

    // parse the incoming cursor
    if (after) {
      const parsed = parseCursor(after);
      if (parsed && typeof parsed === 'object') {
        requestParams = { ...requestParams, ...parsed };
      } else {
        throw new Error(`An invalid 'after' cursor was provided: ${after}`);
      }
    }

    // TODO: This feels like something RESTDataSource should handle out of the box,
    // but doesn't seem to be working. `filter` is an object, and the WCC media api
    // expects filter params to look like ?filter[someKey]=someValue&filter[someOtherKey]=someOtherValue
    // yet RESTDataSource does something like ?filter={ someKey: somevalue, someOtherKey: someOtherValue }
    const { filter } = requestParams;
    delete requestParams.filter;
    if (filter) {
      Object.keys(filter).forEach((key) => {
        requestParams[`filter[${key}]`] = filter[key];
      });
    }

    const result = await this.get('', requestParams);
    if (!result || result.error)
      throw new ApolloError(result?.error?.message, result?.error?.code);

    // All pagination cursors below inherit these fields
    const paginationPartsForCursors = {
      limit: result.pagination.limit,
      offset: result.pagination.offset,
      order_by: result.pagination.order_by,
      sort: result.pagination.sort,
      filter: result.pagination.filter,
    };

    const getTotalCount = () => result.pagination.total;

    // build the edges - translate messages to { edges: [{ node, cursor }] } format
    const edges = (result.messages || []).map((node, i) => ({
      node,
      cursor: createCursor({
        ...paginationPartsForCursors,
        offset: paginationPartsForCursors.offset + i + 1,
      }),
    }));

    return {
      edges,
      getTotalCount,
    };
  }

  getCoverImage = ({ images, thumbnail_url, series }) => ({
    sources: [
      {
        uri:
          get(images, 'square.url') ||
          values(images).find(({ url } = {}) => url)?.url ||
          thumbnail_url ||
          seriesResolver.WCCSeries.coverImage(series),
      },
    ],
  });
}

export default dataSource;
