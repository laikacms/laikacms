import { type DocumentsContractCase, documentsContractRegistry } from '../../domain/documents/testing/index.js';

import {
  type DocumentModel,
  type DocumentModelStrict,
  DrizzleDocumentsRepository,
  type RevisionModel,
  type RevisionModelStrict,
} from './documents-repository.js';

type DocCond =
  | { kind: 'eq', key: string }
  | { kind: 'startsWith', prefix: string }
  | { kind: 'statusEq', status: string }
  | { kind: 'statusNeq', status: string }
  | { kind: 'statusIn', values: string[] }
  | { kind: 'depthLte', depth: number }
  | { kind: 'and', children: DocCond[] };

type RevCond =
  | { kind: 'keyEq', key: string }
  | { kind: 'revEq', revision: string }
  | { kind: 'and', children: RevCond[] };

const docMatches = (row: DocumentModel, cond: DocCond): boolean => {
  if (cond.kind === 'eq') return row.key === cond.key;
  if (cond.kind === 'startsWith') return row.key.startsWith(cond.prefix);
  if (cond.kind === 'statusEq') return (row.status ?? '') === cond.status;
  if (cond.kind === 'statusNeq') return (row.status ?? '') !== cond.status;
  if (cond.kind === 'statusIn') return cond.values.includes(row.status ?? '');
  if (cond.kind === 'depthLte') return row.depth <= cond.depth;
  return cond.children.every(c => docMatches(row, c));
};

const revMatches = (row: RevisionModel, cond: RevCond): boolean => {
  if (cond.kind === 'keyEq') return row.key === cond.key;
  if (cond.kind === 'revEq') return row.revision === cond.revision;
  return cond.children.every(c => revMatches(row, c));
};

export const drizzleDocumentsContractCase: DocumentsContractCase = {
  name: 'DrizzleDocumentsRepository (in-memory builders)',
  makeRepo: () => {
    const docs: DocumentModel[] = [];
    const revs: RevisionModel[] = [];

    const repo = new DrizzleDocumentsRepository({
      documentQueryBuilders: {
        keyEquals: value => ({ kind: 'eq', key: value }) as DocCond,
        keyStartsWith: prefix => ({ kind: 'startsWith', prefix }) as DocCond,
        statusEquals: value => ({ kind: 'statusEq', status: value }) as DocCond,
        statusNotEquals: value => ({ kind: 'statusNeq', status: value }) as DocCond,
        statusIn: values => ({ kind: 'statusIn', values }) as DocCond,
        depthLte: value => ({ kind: 'depthLte', depth: value }) as DocCond,
        and: (...children) => ({ kind: 'and', children: children as DocCond[] }) as DocCond,
      },
      revisionQueryBuilders: {
        keyEquals: value => ({ kind: 'keyEq', key: value }) as RevCond,
        revisionEquals: value => ({ kind: 'revEq', revision: value }) as RevCond,
        and: (...children) => ({ kind: 'and', children: children as RevCond[] }) as RevCond,
      },
      callbacks: {
        documents: {
          async insert({ values }) {
            const existing = docs.findIndex(r => r.key === values.key);
            if (existing !== -1) docs.splice(existing, 1);
            docs.push({ ...(values as DocumentModelStrict) });
            return [{ ...(values as DocumentModelStrict) }];
          },
          async update({ where, values }) {
            const cond = where as DocCond;
            const updated: DocumentModel[] = [];
            for (let i = 0; i < docs.length; i += 1) {
              if (docMatches(docs[i]!, cond)) {
                docs[i] = { ...docs[i]!, ...values };
                updated.push({ ...docs[i]! });
              }
            }
            return updated;
          },
          async delete({ where }) {
            const cond = where as DocCond;
            const removed: DocumentModel[] = [];
            for (let i = docs.length - 1; i >= 0; i -= 1) {
              if (docMatches(docs[i]!, cond)) {
                removed.push(docs[i]!);
                docs.splice(i, 1);
              }
            }
            return removed;
          },
          async select({ where, limit, offset, excludeContent }) {
            const cond = where as DocCond;
            let out = docs.filter(r => docMatches(r, cond));
            out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
            if (offset) out = out.slice(offset);
            if (limit) out = out.slice(0, limit);
            return excludeContent ? out.map(r => ({ ...r, content: '' })) : out;
          },
        },
        revisions: {
          async insert({ values }) {
            revs.push({ ...(values as RevisionModelStrict) });
            return [{ ...(values as RevisionModelStrict) }];
          },
          async update({ where, values }) {
            const cond = where as RevCond;
            const updated: RevisionModel[] = [];
            for (let i = 0; i < revs.length; i += 1) {
              if (revMatches(revs[i]!, cond)) {
                revs[i] = { ...revs[i]!, ...values };
                updated.push({ ...revs[i]! });
              }
            }
            return updated;
          },
          async delete({ where }) {
            const cond = where as RevCond;
            const removed: RevisionModel[] = [];
            for (let i = revs.length - 1; i >= 0; i -= 1) {
              if (revMatches(revs[i]!, cond)) {
                removed.push(revs[i]!);
                revs.splice(i, 1);
              }
            }
            return removed;
          },
          async select({ where, limit, excludeContent }) {
            const cond = where as RevCond;
            const out = revs.filter(r => revMatches(r, cond));
            out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
            const limited = limit ? out.slice(0, limit) : out;
            return excludeContent ? limited.map(r => ({ ...r, content: '' })) : limited;
          },
        },
      },
    });

    return repo;
  },
};

documentsContractRegistry.push(drizzleDocumentsContractCase);
