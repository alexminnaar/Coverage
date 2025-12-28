#!/usr/bin/env python3
"""
Test script for PostgreSQL integration in the AI service.

This script tests:
1. Database connection
2. Querying elements by search terms
3. Extracting element context
4. Verifying element IDs

Usage:
    python test_db_integration.py [project_id]
"""

import asyncio
import sys
import os
from dotenv import load_dotenv

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.llm_service import llm_service

load_dotenv()


async def test_database_connection():
    """Test 1: Database connection"""
    print("=" * 60)
    print("Test 1: Database Connection")
    print("=" * 60)
    
    await llm_service._ensure_db_pool()
    
    if llm_service.db_pool:
        print("✅ Database connection pool created")
        
        # Test a simple query
        try:
            async with llm_service.db_pool.acquire() as conn:
                result = await conn.fetchval('SELECT COUNT(*) FROM projects')
                print(f"✅ Found {result} project(s) in database")
        except Exception as e:
            print(f"❌ Database query failed: {e}")
            return False
    else:
        print("❌ Database connection pool is None")
        print("   Check your DATABASE_URL or DB_* environment variables")
        return False
    
    return True


async def test_query_elements(project_id: str):
    """Test 2: Query elements by search terms"""
    print("\n" + "=" * 60)
    print("Test 2: Query Elements by Search Terms")
    print("=" * 60)
    
    if not project_id:
        print("⚠️  Skipping: No project_id provided")
        print("   Usage: python test_db_integration.py <project_id>")
        return
    
    # Test search for common terms
    search_terms = ['John', 'Sarah', 'INT.', 'EXT.']
    print(f"Searching for: {search_terms}")
    
    element_ids = await llm_service._query_elements_by_search(
        project_id,
        search_terms,
        element_types=['dialogue', 'character', 'scene-heading']
    )
    
    print(f"✅ Found {len(element_ids)} matching elements")
    if element_ids:
        print(f"   First 5 IDs: {element_ids[:5]}")
    else:
        print("   ⚠️  No elements found. Try different search terms or check project_id")
    
    return element_ids


async def test_extract_context(project_id: str, element_ids: list):
    """Test 3: Extract element context"""
    print("\n" + "=" * 60)
    print("Test 3: Extract Element Context")
    print("=" * 60)
    
    if not element_ids:
        print("⚠️  Skipping: No element IDs from previous test")
        return
    
    # Test extracting context for first 3 elements
    test_ids = element_ids[:3]
    print(f"Extracting context for {len(test_ids)} elements (with 3 elements before/after each)")
    
    context = await llm_service._extract_element_context(
        project_id,
        test_ids,
        context_size=3
    )
    
    if context:
        lines = context.split('\n')
        print(f"✅ Extracted {len(lines)} lines of context")
        print(f"   Preview (first 200 chars):\n{context[:200]}...")
    else:
        print("❌ No context extracted")
    
    return context


async def test_verify_element_ids(project_id: str, element_ids: list):
    """Test 4: Verify element IDs"""
    print("\n" + "=" * 60)
    print("Test 4: Verify Element IDs")
    print("=" * 60)
    
    if not element_ids:
        print("⚠️  Skipping: No element IDs from previous test")
        return
    
    # Test with valid IDs
    test_ids = element_ids[:3]
    print(f"Verifying {len(test_ids)} element IDs...")
    
    verified = await llm_service._verify_element_ids(project_id, test_ids)
    
    all_valid = all(verified.values())
    print(f"✅ Verification complete:")
    for eid, valid in verified.items():
        status = "✅" if valid else "❌"
        print(f"   {status} {eid[:8]}...")
    
    # Test with invalid ID
    print(f"\nTesting with invalid ID...")
    invalid_ids = ['00000000-0000-0000-0000-000000000000']
    invalid_verified = await llm_service._verify_element_ids(project_id, invalid_ids)
    if not invalid_verified[invalid_ids[0]]:
        print(f"✅ Correctly identified invalid ID")
    else:
        print(f"⚠️  Invalid ID was marked as valid (might be expected if DB unavailable)")
    
    return verified


async def test_full_flow(project_id: str):
    """Test 5: Full flow simulation"""
    print("\n" + "=" * 60)
    print("Test 5: Full Flow Simulation (Edit Mode Graph)")
    print("=" * 60)
    
    if not project_id:
        print("⚠️  Skipping: No project_id provided")
        return
    
    print("This test simulates what happens in edit mode:")
    print("1. User sends: 'Make John's dialogue more dramatic'")
    print("2. LocateScenesNode queries DB for 'John'")
    print("3. LoadContextNode extracts context around found elements")
    print("4. Rest of graph uses minimal context")
    
    # Simulate step 1: Find elements with "John"
    print("\nStep 1: Searching for 'John'...")
    element_ids = await llm_service._query_elements_by_search(
        project_id,
        ['John'],
        element_types=['dialogue', 'character']
    )
    
    if element_ids:
        print(f"   ✅ Found {len(element_ids)} elements")
        
        # Simulate step 2: Extract context
        print("\nStep 2: Extracting context...")
        context = await llm_service._extract_element_context(
            project_id,
            element_ids[:5],  # First 5
            context_size=3
        )
        
        if context:
            context_size = len(context)
            print(f"   ✅ Extracted {context_size} characters of context")
            print(f"   📊 This is much smaller than sending the entire screenplay!")
        else:
            print("   ⚠️  No context extracted")
    else:
        print("   ⚠️  No elements found for 'John'")
        print("   Try a different search term that exists in your screenplay")


async def main():
    """Run all tests"""
    project_id = sys.argv[1] if len(sys.argv) > 1 else None
    
    print("🧪 Testing PostgreSQL Integration for AI Service")
    print("=" * 60)
    
    # Test 1: Connection
    connected = await test_database_connection()
    if not connected:
        print("\n❌ Database connection failed. Cannot continue with other tests.")
        print("\nTroubleshooting:")
        print("1. Check if PostgreSQL is running: docker-compose ps")
        print("2. Check environment variables: DATABASE_URL or DB_*")
        print("3. Check database credentials in .env file")
        return
    
    # Test 2-4: Query operations (require project_id)
    if project_id:
        element_ids = await test_query_elements(project_id)
        await test_extract_context(project_id, element_ids)
        await test_verify_element_ids(project_id, element_ids)
        await test_full_flow(project_id)
    else:
        print("\n" + "=" * 60)
        print("ℹ️  To test query operations, provide a project_id:")
        print("   python test_db_integration.py <project_id>")
        print("\nTo get a project_id:")
        print("1. Open the app and create/open a screenplay")
        print("2. Check the browser console for project ID")
        print("3. Or query the database: SELECT id FROM projects LIMIT 1;")
    
    print("\n" + "=" * 60)
    print("✅ Testing complete!")
    print("=" * 60)


if __name__ == '__main__':
    asyncio.run(main())

