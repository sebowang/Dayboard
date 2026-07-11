f=open("code/src/App.tsx","r",encoding="utf-8")
l=f.readlines()
f.close()

# Simple bracket count for JSX braces and parens
depth = 0
for i, line in enumerate(l):
    s = line.strip()
    depth += s.count("{") - s.count("}")
    if s == "}" and depth == 0:
        print(f"Found App closing at line {i+1}")
        break