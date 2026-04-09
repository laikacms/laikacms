# Laika CMS Repository Architecture

This document explains how repositories work in Laika CMS.

## Overview

Laika CMS uses a **repository pattern** to abstract data storage and retrieval. There are three main
types of repositories:

- **Document Repository** (blue) - Handles structured content/documents (JSON, YAML, etc.)
- **Asset Repository** (green) - Handles binary assets (images, files, etc.)
- **Storage Repository** (orange) - Handles raw storage operations

## Architecture Diagram

```mermaid
flowchart TB
    subgraph Legend
        direction LR
        DocLegend[Document Repository]:::document
        AssetLegend[Asset Repository]:::asset
        StorageLegend[Storage Repository]:::storage
    end

    subgraph Client["Client"]
        DecapCMS[Decap CMS]
        
        subgraph ClientRepos["Client Repositories"]
            AssetRepo[Asset Repository]:::asset
            DocRepo[Document Repository]:::document
        end
        
        subgraph ClientRouting["Routing Layer"]
            AssetRoutingRepo[Routing Repository]:::asset
            DocRoutingRepo[Routing Repository]:::document
        end
        
        subgraph ClientImplementations["Client Repository Implementations"]
            LocalStorageDocRepo[LocalStorage Document Repository]:::document
            GithubRepo[Github Repository]:::document
            DocStorageAdapter[Document Storage Adapter Repository]:::document
            DocHTTPProxy[Document HTTP Proxy Repository]:::document
            
            AlgoliaRepo[Algolia Repository]:::asset
            AssetStorageAdapter[Asset Storage Adapter Repository]:::asset
            AssetHTTPProxy[Asset HTTP Proxy Repository]:::asset
        end
        
        StorageHTTPProxy[Storage HTTP Proxy Repository]:::storage
        DocStorageAdapter2[Document Storage Adapter Repository]:::document
    end

    subgraph Backend["Backend"]
        subgraph APIServers["API Servers"]
            AssetsAPIServer[Assets API Server]
            DocumentAPIServer[Document API Server]
            StorageAPIServer[Storage API Server]
        end
        
        subgraph BackendRepos["Backend Repositories"]
            BackendDocRepo[Document Repository]:::document
            BackendAssetRepo[Asset Repository]:::asset
            BackendStorageRepo[Storage Repository]:::storage
        end
        
        subgraph BackendRouting["Routing Repositories"]
            DocRoutingBackend[Routing Repository]:::document
            AssetRoutingBackend[Routing Repository]:::asset
            StorageRoutingBackend[Routing Repository]:::storage
        end
        
        subgraph DocumentImplementations["Document Repository Implementations"]
            DynamoDBRepo[DynamoDB Repository]:::document
            ExcelRepo[Excel Sheet Repository]:::document
            LDAPRepo[LDAP Repository]:::document
        end
        
        subgraph AssetImplementations["Asset Repository Implementations"]
            S3Repo[S3 Repository]:::asset
            GoogleDriveRepo[Google Drive Repository]:::asset
            FTPRepo[FTP Repository]:::asset
        end
        
        subgraph StorageImplementations["Storage Repository Implementations"]
            AzureBlobRepo[Azure Blob Storage]:::storage
            DropboxRepo[Dropbox Repository]:::storage
            CloudflareR2Repo[Cloudflare R2 Repository]:::storage
        end
    end

    %% Client Flow
    DecapCMS --> AssetRepo
    DecapCMS --> DocRepo
    
    AssetRepo --> AssetRoutingRepo
    DocRepo --> DocRoutingRepo
    
    DocRoutingRepo --> LocalStorageDocRepo
    DocRoutingRepo --> GithubRepo
    DocRoutingRepo --> DocStorageAdapter
    DocRoutingRepo --> DocHTTPProxy
    
    AssetRoutingRepo --> AlgoliaRepo
    AssetRoutingRepo --> AssetStorageAdapter
    AssetRoutingRepo --> AssetHTTPProxy
    
    DocStorageAdapter --> DocStorageAdapter2
    AssetStorageAdapter --> DocStorageAdapter2
    DocStorageAdapter2 --> StorageHTTPProxy
    
    %% HTTP Proxy to Backend
    DocHTTPProxy --> DocumentAPIServer
    AssetHTTPProxy --> AssetsAPIServer
    StorageHTTPProxy --> StorageAPIServer
    
    %% Backend Flow
    AssetsAPIServer --> BackendDocRepo
    DocumentAPIServer --> BackendAssetRepo
    StorageAPIServer --> BackendStorageRepo
    
    BackendDocRepo --> DocRoutingBackend
    BackendAssetRepo --> AssetRoutingBackend
    BackendStorageRepo --> StorageRoutingBackend
    
    DocRoutingBackend --> DynamoDBRepo
    DocRoutingBackend --> ExcelRepo
    DocRoutingBackend --> LDAPRepo
    
    AssetRoutingBackend --> S3Repo
    AssetRoutingBackend --> GoogleDriveRepo
    AssetRoutingBackend --> FTPRepo
    
    StorageRoutingBackend --> AzureBlobRepo
    StorageRoutingBackend --> DropboxRepo
    StorageRoutingBackend --> CloudflareR2Repo

    %% Styling
    classDef document fill:#dae8fc,stroke:#6c8ebf,color:#000
    classDef asset fill:#d5e8d4,stroke:#82b366,color:#000
    classDef storage fill:#ffe6cc,stroke:#d79b00,color:#000
```

## How Repositories Work

### Repository Types

1. **Document Repository**
   - Stores and retrieves structured content (pages, posts, settings)
   - Implementations: LocalStorage, GitHub, DynamoDB, Excel, LDAP

2. **Asset Repository**
   - Manages binary files like images, PDFs, videos
   - Implementations: Algolia (search), S3, Google Drive, FTP

3. **Storage Repository**
   - Low-level storage abstraction for raw data
   - Implementations: Azure Blob, Dropbox, Cloudflare R2

### Routing Repository Pattern

The **Routing Repository** is a key pattern in Laika CMS that enables:

- **Multi-backend support**: Route requests to different storage backends based on configuration
- **Fallback chains**: Try multiple repositories in sequence
- **Environment-specific storage**: Use LocalStorage in development, cloud storage in production

### Client-Server Architecture

```mermaid
sequenceDiagram
    participant CMS as Decap CMS
    participant Repo as Repository
    participant Routing as Routing Repository
    participant Proxy as HTTP Proxy Repository
    participant API as Backend API Server
    participant Backend as Backend Repository
    participant Storage as Storage Implementation

    CMS->>Repo: save(document)
    Repo->>Routing: route(document)
    
    alt Local Storage
        Routing->>Routing: save to LocalStorage
    else Remote Storage
        Routing->>Proxy: forward request
        Proxy->>API: HTTP POST /documents
        API->>Backend: save(document)
        Backend->>Storage: write to storage
        Storage-->>Backend: success
        Backend-->>API: success
        API-->>Proxy: 200 OK
        Proxy-->>Routing: success
    end
    
    Routing-->>Repo: success
    Repo-->>CMS: saved
```

### Storage Adapter Pattern

The **Storage Adapter Repository** bridges between document/asset repositories and raw storage:

```mermaid
flowchart LR
    subgraph "High-Level"
        Doc[Document Repository]
        Asset[Asset Repository]
    end
    
    subgraph "Adapter Layer"
        DocAdapter[Document Storage Adapter]:::document
        AssetAdapter[Asset Storage Adapter]:::asset
    end
    
    subgraph "Low-Level"
        Storage[Storage Repository]:::storage
    end
    
    Doc --> DocAdapter
    Asset --> AssetAdapter
    DocAdapter --> Storage
    AssetAdapter --> Storage
    
    classDef document fill:#dae8fc,stroke:#6c8ebf,color:#000
    classDef asset fill:#d5e8d4,stroke:#82b366,color:#000
    classDef storage fill:#ffe6cc,stroke:#d79b00,color:#000
```

This allows:

- Documents and assets to be stored in any storage backend
- Consistent serialization/deserialization
- Unified error handling and retry logic

## Key Benefits

1. **Flexibility**: Swap storage backends without changing application code
2. **Testability**: Use LocalStorage or mock repositories in tests
3. **Scalability**: Route to different backends based on content type or size
4. **Offline Support**: LocalStorage repositories enable offline-first editing
5. **Multi-cloud**: Support multiple cloud providers simultaneously
