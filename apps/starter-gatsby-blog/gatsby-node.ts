import path from 'node:path';

import type { GatsbyNode } from 'gatsby';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './src/lib/laika';

/**
 * Gatsby's build-time data sourcing via sourceNodes.
 *
 * Doc gap: This is LaikaCMS's most unique integration pattern. Unlike all
 * other starters (which read content at request time), Gatsby reads ALL
 * content at build time and loads it into the Gatsby data layer (GraphQL).
 * Pages and components then query this data via GraphQL — laika.documents.*
 * is never called at request time.
 *
 * Doc gap: Each document is fetched individually (getDocument per summary item)
 * to include content fields (title, date, body) in the Gatsby node. For large
 * sites, consider reading only the metadata in sourceNodes and loading full
 * content in createPages via a separate getDocument call.
 *
 * Doc gap: createContentDigest is required for Gatsby's cache invalidation.
 * Pass the full content object — Gatsby uses it to determine whether a node
 * has changed between builds.
 */
export const sourceNodes: GatsbyNode['sourceNodes'] = async ({
  actions,
  createContentDigest,
  createNodeId,
}) => {
  const { createNode } = actions;

  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );

  for (const item of items.filter(r => r.type === 'published-summary')) {
    let content: Record<string, unknown> = {};
    try {
      const doc = await runTask(laika.documents.getDocument(item.key));
      content = (doc.content as Record<string, unknown>) ?? {};
    } catch {
      // Skip unparseable documents
    }

    const slug = item.key.replace(/^posts\//, '').replace(/\.md$/, '');

    createNode({
      id: createNodeId(`laika-post-${item.key}`),
      laikaKey: item.key,
      slug,
      title: (content['title'] as string) ?? slug,
      date: (content['date'] as string) ?? item.updatedAt ?? '',
      description: (content['description'] as string) ?? '',
      body: (content['body'] as string) ?? '',
      internal: {
        type: 'LaikaPost',
        contentDigest: createContentDigest({ item, content }),
      },
    });
  }
};

/**
 * createSchemaCustomization — define explicit GraphQL types for LaikaCMS nodes.
 *
 * Doc gap: Without this, Gatsby infers types from the first node it sees.
 * If there are no posts, Gatsby generates no LaikaPost type and queries fail.
 * Explicitly define the type so queries always work even on empty sites.
 */
export const createSchemaCustomization: GatsbyNode['createSchemaCustomization'] = ({ actions }) => {
  const { createTypes } = actions;
  createTypes(`
    type LaikaPost implements Node {
      laikaKey: String!
      slug: String!
      title: String!
      date: String
      description: String
      body: String
    }
  `);
};

/**
 * createPages — generate a page for each LaikaCMS post.
 *
 * Doc gap: Gatsby creates pages programmatically here, using the GraphQL data
 * populated in sourceNodes. The slug becomes the URL path; the template
 * component queries the same GraphQL layer for full content.
 */
export const createPages: GatsbyNode['createPages'] = async ({ graphql, actions }) => {
  const { createPage } = actions;

  const result = await graphql<{ allLaikaPost: { nodes: Array<{ slug: string }> } }>(`
    query {
      allLaikaPost {
        nodes {
          slug
        }
      }
    }
  `);

  if (result.errors) throw result.errors[0];

  const component = path.resolve('./src/templates/blog-post.tsx');
  for (const { slug } of result.data?.allLaikaPost.nodes ?? []) {
    createPage({ path: `/blog/${slug}`, component, context: { slug } });
  }
};
