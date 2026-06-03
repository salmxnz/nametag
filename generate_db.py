import csv
import json
import uuid
import sys

def generate_db(csv_path, output_path="data/db.json"):
    teams = {}
    participants = []

    with open(csv_path, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            team_name = row["Team Name"].strip()
            member_name = row["Member"].strip()

            if team_name not in teams:
                teams[team_name] = str(uuid.uuid4())[:8]

            participants.append({
                "id": str(uuid.uuid4())[:8],
                "name": member_name,
                "email": row["Email"].strip(),
                "year": int(row["Year"].strip()),
                "food": row["Food"].strip(),
                "shirt": row["Shirt"].strip(),
                "teamId": teams[team_name]
            })

    db = {
        "teams": [
            {
                "id": tid,
                "name": tname,
                "logo": f"photos/team-logos/{tname}.jpg"
            }
            for tname, tid in teams.items()
        ],
        "participants": participants
    }

    with open(output_path, "w", encoding='utf-8') as f:
        json.dump(db, f, indent=2, ensure_ascii=False)

    print(f"Generated {output_path}")
    print(f"  {len(db['teams'])} teams")
    print(f"  {len(db['participants'])} participants")

if __name__ == "__main__":
    csv_file = sys.argv[1] if len(sys.argv) > 1 else "team_finalised.csv"
    generate_db(csv_file)
