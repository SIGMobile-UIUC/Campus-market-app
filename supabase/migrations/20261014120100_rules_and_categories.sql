-- DB-5: item categories and rule values (spec 1.7.1, 1.7.2, 1.7.5, 5.6). Starting values only; after this
-- a super admin changes them through app_config, so a later migration never overwrites them.

-- The app reads categories (public); rule values stay server-side. Icons are lucide icon names.
insert into public.app_config (key, value, public) values ('categories', '{
  "categories": [
    {
      "id": "furniture",
      "label": "Furniture",
      "icon": "sofa",
      "subcategories": [
        {
          "id": "desks",
          "label": "Desks"
        },
        {
          "id": "chairs",
          "label": "Chairs"
        },
        {
          "id": "bed_frames_and_mattresses",
          "label": "Bed frames and mattresses"
        },
        {
          "id": "couches_and_seating",
          "label": "Couches and seating"
        },
        {
          "id": "tables",
          "label": "Tables"
        },
        {
          "id": "shelves_and_bookcases",
          "label": "Shelves and bookcases"
        },
        {
          "id": "dressers_and_wardrobes",
          "label": "Dressers and wardrobes"
        }
      ]
    },
    {
      "id": "appliances",
      "label": "Appliances",
      "icon": "refrigerator",
      "subcategories": [
        {
          "id": "mini_fridges",
          "label": "Mini fridges"
        },
        {
          "id": "microwaves",
          "label": "Microwaves"
        },
        {
          "id": "fans_and_heaters",
          "label": "Fans and heaters"
        },
        {
          "id": "air_purifiers_and_humidifiers",
          "label": "Air purifiers and humidifiers"
        },
        {
          "id": "vacuums",
          "label": "Vacuums"
        },
        {
          "id": "tvs",
          "label": "TVs"
        }
      ]
    },
    {
      "id": "kitchen",
      "label": "Kitchen",
      "icon": "cooking-pot",
      "subcategories": [
        {
          "id": "kettles_and_coffee_makers",
          "label": "Kettles and coffee makers"
        },
        {
          "id": "rice_cookers_and_air_fryers",
          "label": "Rice cookers and air fryers"
        },
        {
          "id": "cookware",
          "label": "Cookware"
        },
        {
          "id": "dishes_and_utensils",
          "label": "Dishes and utensils"
        },
        {
          "id": "food_storage",
          "label": "Food storage"
        }
      ]
    },
    {
      "id": "bedding_and_bath",
      "label": "Bedding and bath",
      "icon": "bed-double",
      "subcategories": [
        {
          "id": "sheets_and_comforters",
          "label": "Sheets and comforters"
        },
        {
          "id": "mattress_toppers",
          "label": "Mattress toppers"
        },
        {
          "id": "pillows",
          "label": "Pillows"
        },
        {
          "id": "towels",
          "label": "Towels"
        },
        {
          "id": "shower_caddies",
          "label": "Shower caddies"
        }
      ]
    },
    {
      "id": "decor_and_storage",
      "label": "Decor and storage",
      "icon": "lamp",
      "subcategories": [
        {
          "id": "lamps_and_lighting",
          "label": "Lamps and lighting"
        },
        {
          "id": "rugs_and_curtains",
          "label": "Rugs and curtains"
        },
        {
          "id": "mirrors",
          "label": "Mirrors"
        },
        {
          "id": "wall_decor",
          "label": "Wall decor"
        },
        {
          "id": "storage_bins_and_organizers",
          "label": "Storage bins and organizers"
        },
        {
          "id": "laundry_hampers_and_drying_racks",
          "label": "Laundry hampers and drying racks"
        }
      ]
    },
    {
      "id": "electronics",
      "label": "Electronics",
      "icon": "laptop",
      "subcategories": [
        {
          "id": "laptops",
          "label": "Laptops"
        },
        {
          "id": "tablets",
          "label": "Tablets"
        },
        {
          "id": "monitors",
          "label": "Monitors"
        },
        {
          "id": "phones",
          "label": "Phones"
        },
        {
          "id": "headphones_and_speakers",
          "label": "Headphones and speakers"
        },
        {
          "id": "cameras",
          "label": "Cameras"
        },
        {
          "id": "chargers_and_accessories",
          "label": "Chargers and accessories"
        }
      ]
    },
    {
      "id": "video_games",
      "label": "Video games",
      "icon": "gamepad-2",
      "subcategories": [
        {
          "id": "consoles",
          "label": "Consoles"
        },
        {
          "id": "games",
          "label": "Games"
        },
        {
          "id": "controllers_and_accessories",
          "label": "Controllers and accessories"
        },
        {
          "id": "vr",
          "label": "VR"
        }
      ]
    },
    {
      "id": "textbooks",
      "label": "Textbooks",
      "icon": "book-open",
      "subcategories": [
        {
          "id": "by_course_code",
          "label": "By course code"
        },
        {
          "id": "lab_manuals",
          "label": "Lab manuals"
        },
        {
          "id": "study_guides_and_test_prep",
          "label": "Study guides and test prep"
        }
      ]
    },
    {
      "id": "school_and_office_supplies",
      "label": "School and office supplies",
      "icon": "pencil-ruler",
      "subcategories": [
        {
          "id": "calculators",
          "label": "Calculators"
        },
        {
          "id": "lab_gear",
          "label": "Lab gear"
        },
        {
          "id": "backpacks",
          "label": "Backpacks"
        },
        {
          "id": "printers",
          "label": "Printers"
        },
        {
          "id": "notebooks_and_stationery",
          "label": "Notebooks and stationery"
        }
      ]
    },
    {
      "id": "womens_clothing",
      "label": "Women''s clothing",
      "icon": "shirt",
      "subcategories": [
        {
          "id": "tops",
          "label": "Tops"
        },
        {
          "id": "bottoms",
          "label": "Bottoms"
        },
        {
          "id": "dresses",
          "label": "Dresses"
        },
        {
          "id": "outerwear",
          "label": "Outerwear"
        },
        {
          "id": "activewear",
          "label": "Activewear"
        },
        {
          "id": "formal_wear",
          "label": "Formal wear"
        }
      ]
    },
    {
      "id": "mens_clothing",
      "label": "Men''s clothing",
      "icon": "shirt",
      "subcategories": [
        {
          "id": "tops",
          "label": "Tops"
        },
        {
          "id": "bottoms",
          "label": "Bottoms"
        },
        {
          "id": "outerwear",
          "label": "Outerwear"
        },
        {
          "id": "activewear",
          "label": "Activewear"
        },
        {
          "id": "suits_and_formal_wear",
          "label": "Suits and formal wear"
        }
      ]
    },
    {
      "id": "shoes_bags_and_accessories",
      "label": "Shoes, bags and accessories",
      "icon": "handbag",
      "subcategories": [
        {
          "id": "sneakers",
          "label": "Sneakers"
        },
        {
          "id": "boots",
          "label": "Boots"
        },
        {
          "id": "bags",
          "label": "Bags"
        },
        {
          "id": "jewelry",
          "label": "Jewelry"
        },
        {
          "id": "watches",
          "label": "Watches"
        },
        {
          "id": "hats",
          "label": "Hats"
        }
      ]
    },
    {
      "id": "campus_gear",
      "label": "Campus gear",
      "icon": "trophy",
      "subcategories": [
        {
          "id": "jerseys_and_spirit_wear",
          "label": "Jerseys and spirit wear"
        },
        {
          "id": "game_day_and_tailgate",
          "label": "Game day and tailgate"
        },
        {
          "id": "club_and_greek_merch",
          "label": "Club and Greek merch"
        }
      ]
    },
    {
      "id": "bikes_and_scooters",
      "label": "Bikes and scooters",
      "icon": "bike",
      "subcategories": [
        {
          "id": "bikes",
          "label": "Bikes"
        },
        {
          "id": "escooters_and_ebikes",
          "label": "E-scooters and e-bikes"
        },
        {
          "id": "skateboards",
          "label": "Skateboards"
        },
        {
          "id": "locks",
          "label": "Locks"
        },
        {
          "id": "helmets_and_lights",
          "label": "Helmets and lights"
        }
      ]
    },
    {
      "id": "sports_and_outdoors",
      "label": "Sports and outdoors",
      "icon": "dumbbell",
      "subcategories": [
        {
          "id": "gym_equipment",
          "label": "Gym equipment"
        },
        {
          "id": "rackets_and_balls",
          "label": "Rackets and balls"
        },
        {
          "id": "yoga_and_fitness",
          "label": "Yoga and fitness"
        },
        {
          "id": "camping_and_hiking",
          "label": "Camping and hiking"
        },
        {
          "id": "winter_sports",
          "label": "Winter sports"
        }
      ]
    },
    {
      "id": "music",
      "label": "Music",
      "icon": "guitar",
      "subcategories": [
        {
          "id": "instruments",
          "label": "Instruments"
        },
        {
          "id": "amps_and_audio_gear",
          "label": "Amps and audio gear"
        },
        {
          "id": "dj_and_production_gear",
          "label": "DJ and production gear"
        },
        {
          "id": "vinyl_and_cds",
          "label": "Vinyl and CDs"
        }
      ]
    },
    {
      "id": "hobbies_and_games",
      "label": "Hobbies and games",
      "icon": "puzzle",
      "subcategories": [
        {
          "id": "board_games_and_puzzles",
          "label": "Board games and puzzles"
        },
        {
          "id": "art_supplies",
          "label": "Art supplies"
        },
        {
          "id": "crafts",
          "label": "Crafts"
        },
        {
          "id": "books_other_than_textbooks",
          "label": "Books other than textbooks"
        },
        {
          "id": "collectibles",
          "label": "Collectibles"
        }
      ]
    },
    {
      "id": "beauty_and_personal_care",
      "label": "Beauty and personal care",
      "icon": "sparkles",
      "subcategories": [
        {
          "id": "hair_tools",
          "label": "Hair tools"
        },
        {
          "id": "skincare_and_makeup",
          "label": "Skincare and makeup (unopened)"
        },
        {
          "id": "fragrance",
          "label": "Fragrance"
        },
        {
          "id": "grooming",
          "label": "Grooming"
        }
      ]
    },
    {
      "id": "pet_supplies",
      "label": "Pet supplies",
      "icon": "paw-print",
      "subcategories": [
        {
          "id": "tanks_and_cages",
          "label": "Tanks and cages"
        },
        {
          "id": "beds_and_toys",
          "label": "Beds and toys"
        },
        {
          "id": "feeders_and_bowls",
          "label": "Feeders and bowls"
        }
      ]
    },
    {
      "id": "plants",
      "label": "Plants",
      "icon": "sprout",
      "subcategories": [
        {
          "id": "houseplants",
          "label": "Houseplants"
        },
        {
          "id": "pots_and_planters",
          "label": "Pots and planters"
        }
      ]
    },
    {
      "id": "other",
      "label": "Other",
      "icon": "ellipsis",
      "subcategories": [
        {
          "id": "party_and_costumes",
          "label": "Party and costumes"
        },
        {
          "id": "everything_else",
          "label": "Everything else"
        }
      ]
    }
  ]
}', true)
on conflict (key) do nothing;

insert into public.app_config (key, value) values ('rank_rules', '{
  "rating_prior": 4.0,
  "rating_weight": 10,
  "partner_window_days": 7,
  "penalty_window_days": 90,
  "c_penalty_points": 6,
  "b_minus": {
    "penalty_points": 3,
    "rating_below": 4.0,
    "min_reviews": 5
  },
  "new_tag_until_trades": 3,
  "grades": [
    {
      "grade": "b_plus",
      "trades": 10,
      "partners": 7,
      "rating": 4.3,
      "age_days": 30,
      "max_penalty": 2
    },
    {
      "grade": "a_minus",
      "trades": 30,
      "partners": 20,
      "rating": 4.5,
      "age_days": 90,
      "max_penalty": 1
    },
    {
      "grade": "a",
      "trades": 75,
      "partners": 45,
      "rating": 4.6,
      "age_days": 180,
      "max_penalty": 0
    },
    {
      "grade": "a_plus",
      "trades": 150,
      "partners": 90,
      "rating": 4.75,
      "age_days": 365,
      "max_penalty": 0
    }
  ],
  "top_badge": {
    "top": 0.05,
    "min_a_plus_users": 20
  },
  "penalties": {
    "no_show": 3,
    "harassment": 3,
    "late_cancel": 1,
    "bad_faith": 3
  },
  "score": "counted_trades * rating_bayes * reply_factor",
  "reply_factor": {
    "fast_minutes": 60,
    "fast": 1.1,
    "default": 1.0
  }
}')
on conflict (key) do nothing;

insert into public.app_config (key, value) values ('points_rules', '{
  "daily_cap": 200,
  "earn": {
    "trade_seller": {
      "points": 50,
      "max_per_day": 3,
      "counted_only": true
    },
    "trade_buyer": {
      "points": 30,
      "max_per_day": 3,
      "counted_only": true
    },
    "trade_giver": {
      "points": 30,
      "max_per_day": 3
    },
    "review": {
      "points": 10
    },
    "first_trade": {
      "points": 100,
      "outside_cap": true
    },
    "checkin": {
      "points": 5,
      "streak_every": 7,
      "streak_bonus": 20
    }
  },
  "spend": {
    "price_by_rarity": {
      "common": 150,
      "rare": 400,
      "epic": 1000,
      "legendary": 2500
    },
    "bump": {
      "points": 150,
      "listing_cooldown_hours": 24,
      "max_per_day": 3
    },
    "nickname": {
      "points": 300,
      "free_within_days": 7,
      "cooldown_days": 30
    },
    "pet_treat": {
      "points": 20,
      "effect_days": 3
    }
  }
}')
on conflict (key) do nothing;
