const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class DatabaseManager {
    constructor(dbPath) {
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.initialize();
    }

    initialize() {
        // Таблица медиа (фильмы/сериалы)
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS media (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        rating REAL DEFAULT 0 CHECK(rating >= 0 AND rating <= 10),
        year INTEGER,
        cover_path TEXT,
        link TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

        // Таблица книг
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        rating REAL DEFAULT 0 CHECK(rating >= 0 AND rating <= 10),
        year INTEGER,
        cover_path TEXT,
        link TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

        // Таблица игр
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        rating REAL DEFAULT 0 CHECK(rating >= 0 AND rating <= 10),
        year INTEGER,
        cover_path TEXT,
        link TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

        // Таблица тегов
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
      )
    `);

        // Связующие таблицы (many-to-many для тегов) [[19]][[21]]
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS media_tags (
        media_id TEXT,
        tag_id INTEGER,
        PRIMARY KEY (media_id, tag_id),
        FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      )
    `);

        this.db.exec(`
      CREATE TABLE IF NOT EXISTS books_tags (
        book_id TEXT,
        tag_id INTEGER,
        PRIMARY KEY (book_id, tag_id),
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      )
    `);

        this.db.exec(`
      CREATE TABLE IF NOT EXISTS games_tags (
        game_id TEXT,
        tag_id INTEGER,
        PRIMARY KEY (game_id, tag_id),
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      )
    `);

        // Таблица коллекций
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        cover_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

        // Связь коллекций с объектами
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS collection_items (
        collection_id TEXT,
        item_id TEXT,
        item_type TEXT CHECK(item_type IN ('media', 'books', 'games')),
        PRIMARY KEY (collection_id, item_id, item_type),
        FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
      )
    `);
    }

    // CRUD операции для Media
    getMedia(filters = {}) {
        let query = 'SELECT * FROM media WHERE 1=1';
        const params = [];

        if (filters.yearFrom) {
            query += ' AND year >= ?';
            params.push(filters.yearFrom);
        }
        if (filters.yearTo) {
            query += ' AND year <= ?';
            params.push(filters.yearTo);
        }
        if (filters.ratingFrom !== undefined) {
            query += ' AND rating >= ?';
            params.push(filters.ratingFrom);
        }
        if (filters.ratingTo !== undefined) {
            query += ' AND rating <= ?';
            params.push(filters.ratingTo);
        }
        if (filters.search) {
            query += ' AND title LIKE ?';
            params.push(`%${filters.search}%`);
        }
        if (filters.tag) {
            query += ` AND id IN (
        SELECT media_id FROM media_tags 
        WHERE tag_id = (SELECT id FROM tags WHERE name = ?)
      )`;
            params.push(filters.tag);
        }

        const items = this.db.prepare(query).all(...params);

        // Добавляем теги к каждому элементу
        return items.map(item => ({
            ...item,
            tags: this.db.prepare(`
        SELECT t.name FROM tags t
        JOIN media_tags mt ON t.id = mt.tag_id
        WHERE mt.media_id = ?
      `).all(item.id).map(t => t.name)
        }));
    }

    addMedia(item) {
        const stmt = this.db.prepare(`
      INSERT INTO media (id, title, description, rating, year, cover_path, link)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(item.id, item.title, item.description || '', item.rating || 0,
            item.year, item.cover_path || '', item.link || '');

        // Добавляем теги
        if (item.tags && item.tags.length > 0) {
            this.addTags('media', item.id, item.tags);
        }
    }

    updateMedia(id, item) {
        const stmt = this.db.prepare(`
      UPDATE media 
      SET title = ?, description = ?, year = ?, cover_path = ?, link = ?
      WHERE id = ?
    `);
        stmt.run(item.title, item.description || '', item.year,
            item.cover_path || '', item.link || '', id);

        // Обновляем теги
        if (item.tags) {
            this.db.prepare('DELETE FROM media_tags WHERE media_id = ?').run(id);
            this.addTags('media', id, item.tags);
        }
    }

    deleteMedia(id) {
        this.db.prepare('DELETE FROM media WHERE id = ?').run(id);
    }

    // Аналогичные методы для Books и Games (упрощённо)
    getBooks(filters = {}) {
        // ... аналогично getMedia
        return this.getAllFromTable('books', 'book_id', filters);
    }

    addBook(item) {
        const stmt = this.db.prepare(`
      INSERT INTO books (id, title, description, rating, year, cover_path, link)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(item.id, item.title, item.description || '', item.rating || 0,
            item.year, item.cover_path || '', item.link || '');

        if (item.tags && item.tags.length > 0) {
            this.addTags('books', item.id, item.tags);
        }
    }

    updateBook(id, item) {
        const stmt = this.db.prepare(`
      UPDATE books 
      SET title = ?, description = ?, year = ?, cover_path = ?, link = ?
      WHERE id = ?
    `);
        stmt.run(item.title, item.description || '', item.year,
            item.cover_path || '', item.link || '', id);

        if (item.tags) {
            this.db.prepare('DELETE FROM books_tags WHERE book_id = ?').run(id);
            this.addTags('books', id, item.tags);
        }
    }

    // Для игр
    getGames(filters = {}) {
        return this.getAllFromTable('games', 'game_id', filters);
    }

    addGame(item) {
        const stmt = this.db.prepare(`
      INSERT INTO games (id, title, description, rating, year, cover_path, link)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(item.id, item.title, item.description || '', item.rating || 0,
            item.year, item.cover_path || '', item.link || '');

        if (item.tags && item.tags.length > 0) {
            this.addTags('games', item.id, item.tags);
        }
    }

    updateGame(id, item) {
        const stmt = this.db.prepare(`
      UPDATE games 
      SET title = ?, description = ?, year = ?, cover_path = ?, link = ?
      WHERE id = ?
    `);
        stmt.run(item.title, item.description || '', item.year,
            item.cover_path || '', item.link || '', id);

        if (item.tags) {
            this.db.prepare('DELETE FROM games_tags WHERE game_id = ?').run(id);
            this.addTags('games', id, item.tags);
        }
    }

    // Вспомогательный метод
    getAllFromTable(table, itemIdColumn, filters = {}) {
        let query = `SELECT * FROM ${table} WHERE 1=1`;
        const params = [];

        if (filters.yearFrom) {
            query += ' AND year >= ?';
            params.push(filters.yearFrom);
        }
        if (filters.yearTo) {
            query += ' AND year <= ?';
            params.push(filters.yearTo);
        }
        if (filters.ratingFrom !== undefined) {
            query += ' AND rating >= ?';
            params.push(filters.ratingFrom);
        }
        if (filters.ratingTo !== undefined) {
            query += ' AND rating <= ?';
            params.push(filters.ratingTo);
        }
        if (filters.search) {
            query += ' AND title LIKE ?';
            params.push(`%${filters.search}%`);
        }
        if (filters.tag) {
            query += ` AND id IN (
        SELECT ${itemIdColumn} FROM ${table}_tags 
        WHERE tag_id = (SELECT id FROM tags WHERE name = ?)
      )`;
            params.push(filters.tag);
        }

        const items = this.db.prepare(query).all(...params);

        return items.map(item => ({
            ...item,
            tags: this.db.prepare(`
        SELECT t.name FROM tags t
        JOIN ${table}_tags mt ON t.id = mt.tag_id
        WHERE mt.${itemIdColumn} = ?
      `).all(item.id).map(t => t.name)
        }));
    }

    // Работа с тегами
    addTags(table, itemId, tagNames) {
        for (const tagName of tagNames) {
            // Добавляем тег если не существует
            this.db.prepare(`
        INSERT OR IGNORE INTO tags (name) VALUES (?)
      `).run(tagName);

            // Получаем ID тега
            const tag = this.db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName);

            // Связываем
            const column = table === 'media' ? 'media_id' :
                table === 'books' ? 'book_id' : 'game_id';

            this.db.prepare(`
        INSERT OR IGNORE INTO ${table}_tags (${column}, tag_id)
        VALUES (?, ?)
      `).run(itemId, tag.id);
        }
    }

    getAllTags() {
        return this.db.prepare('SELECT name FROM tags').all().map(t => t.name);
    }

    // Коллекции
    getCollections() {
        const collections = this.db.prepare('SELECT * FROM collections').all();

        return collections.map(col => {
            const items = this.db.prepare(`
        SELECT item_id, item_type FROM collection_items 
        WHERE collection_id = ?
      `).all(col.id);

            return {
                ...col,
                items: items.map(item => ({
                    ...this.getItemById(item.item_id, item.item_type),
                    type: item.item_type
                }))
            };
        });
    }

    addCollection(collection) {
        const stmt = this.db.prepare(`
      INSERT INTO collections (id, title, description, cover_path)
      VALUES (?, ?, ?, ?)
    `);
        stmt.run(collection.id, collection.title, collection.description || '',
            collection.cover_path || '');
    }

    addToCollection(collectionId, itemId, itemType) {
        this.db.prepare(`
      INSERT OR IGNORE INTO collection_items (collection_id, item_id, item_type)
      VALUES (?, ?, ?)
    `).run(collectionId, itemId, itemType);
    }

    removeFromCollection(collectionId, itemId) {
        this.db.prepare(`
      DELETE FROM collection_items 
      WHERE collection_id = ? AND item_id = ?
    `).run(collectionId, itemId);
    }

    getItemById(id, type) {
        const table = type;
        const item = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);

        if (!item) return null;

        const column = type === 'media' ? 'media_id' :
            type === 'books' ? 'book_id' : 'game_id';

        item.tags = this.db.prepare(`
      SELECT t.name FROM tags t
      JOIN ${table}_tags mt ON t.id = mt.tag_id
      WHERE mt.${column} = ?
    `).all(id).map(t => t.name);

        return item;
    }

    updateCollection(id, collection) {
        const stmt = this.db.prepare(`
      UPDATE collections 
      SET title = ?, description = ?, cover_path = ?
      WHERE id = ?
    `);
        stmt.run(collection.title, collection.description || '',
            collection.cover_path || '', id);
    }

    deleteCollection(id) {
        this.db.prepare('DELETE FROM collections WHERE id = ?').run(id);
    }
}

module.exports = DatabaseManager;
