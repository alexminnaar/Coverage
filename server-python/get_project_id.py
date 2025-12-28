#!/usr/bin/env python3
"""Quick script to get a project ID from the database"""
import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv()

async def get_project_id():
    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        db_host = os.getenv('DB_HOST', 'localhost')
        db_port = int(os.getenv('DB_PORT', '5432'))
        db_name = os.getenv('DB_NAME', 'screenwriter')
        db_user = os.getenv('DB_USER', 'screenwriter')
        db_password = os.getenv('DB_PASSWORD', 'screenwriter')
        db_url = f'postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}'
    
    try:
        conn = await asyncpg.connect(db_url)
        result = await conn.fetchval('SELECT id::text FROM projects LIMIT 1')
        await conn.close()
        return result
    except Exception as e:
        print(f"Error: {e}")
        return None

if __name__ == '__main__':
    project_id = asyncio.run(get_project_id())
    if project_id:
        print(project_id)
    else:
        print("No projects found in database")

