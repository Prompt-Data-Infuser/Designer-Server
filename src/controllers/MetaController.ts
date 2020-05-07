import { Request, Response, NextFunction } from "express";
import * as multiparty from 'multiparty';
import * as Excel from 'exceljs';
import { getConnection, LessThanOrEqual, getRepository, getManager, TableColumn, Table, Column } from "typeorm";
import { Meta } from "../entity/Meta";
import { MetaColumn } from "../entity/MetaColumn";
import { User } from "../entity/User";
import { TableOptions } from "typeorm/schema-builder/options/TableOptions";
import { Api } from "../entity/Api";


class MetaController {

  static uploadXlsxFile = async(req: Request, res: Response) => {
    const metaRepo = getRepository(Meta);
    const metaColRepo = getRepository(MetaColumn);
    
    const promisifyUpload = (req) => new Promise<any>((resolve, reject) => {
      const multipartyOption = {
        autoFiles: true,
        uploadDir: "/Users/chunghyup/node_workspace/files"
      }
      const form = new multiparty.Form(multipartyOption);
  
      form.parse(req, function(err, fields, files) {
          if (err) return reject(err);
          return resolve({
            files: files,
            fields: fields
          });
      });
    });
    try {
      const formData = await promisifyUpload(req);

      let files = formData.files;
      let { title } = formData.fields;

      const filePath = files['upload'][0].path;
      const originalFileName:string = files['upload'][0].originalFilename;
      const originalFileNameTokens = originalFileName.split(".");
      const ext = originalFileNameTokens[originalFileNameTokens.length - 1]
      const loadedWorkbook = await new Excel.Workbook().xlsx.readFile(filePath);
      const worksheet = loadedWorkbook.worksheets[1]
      const totalRowCount = worksheet.rowCount

      const header = worksheet.getRow(1).values;

      const meta = new Meta();
      meta.title = title;
      meta.originalFileName = originalFileName;
      meta.filePath = filePath;
      meta.rowCounts = totalRowCount - 1;
      meta.extension = ext;
      meta.user = <User>req.user;
      
      let columns = []
      for(let i = 1; i < header.length; i++) {
        const col = header[i];
        const metaCol = new MetaColumn();
        metaCol.originalColumnName = col;
        metaCol.columnName = col;
        metaCol.meta = meta;
        metaCol.order = i;
        columns.push(metaCol);
      }

      
      await getManager().transaction("SERIALIZABLE", async transactionalEntityManager => {
        await metaRepo.save(meta);
        await metaColRepo.save(columns);
      })
      res.redirect(`/metas/${meta.id}`);
    } catch (err) {
      console.error(err);
    }
  }
  
  static getIndex = async(req: Request, res: Response, next: NextFunction) => {
    const metaRepo = getRepository(Meta);

    try {
      const apis = await metaRepo.find();

      res.render("metas/index.pug", {
        apis: apis,
        current_user: req.user
      })
    } catch (err) {
      console.error(err);
    }
  }

  static getNew = async(req: Request, res: Response, next: NextFunction) => {
    res.render("metas/new.pug", {
      current_user: req.user
    })
  }

  static getShow = async(req: Request, res: Response, next: NextFunction) => {
    const metaRepo = getRepository(Meta);
    const { id } = req.params
    try {
      const meta = await metaRepo.findOneOrFail({
        relations: ["columns"],
        where: {
          id: id
        }
      })
      res.render("metas/show.pug", {
        current_user: req.user,
        meta: meta
      })
    } catch (err) {
      console.error(err);
    }
  }

  static delete = async(req: Request, res: Response, newxt: NextFunction) => {
    const metaRepo = getRepository(Meta);
    const { id } = req.params;
    try {
      await metaRepo.delete(id);
      res.redirect('/metas')
    } catch (err) {
      console.error(err);
    }
  }

  static getNewApi = async(req: Request, res: Response, next: NextFunction) => {
    const metaRepo = getRepository(Meta);
    const { id } = req.params
    try {
      const meta = await metaRepo.findOneOrFail({
        relations: ["columns"],
        where: {
          id: id
        }
      })
      res.render("metas/api/new.pug", {
        current_user: req.user,
        meta: meta
      })
    } catch (err) {
      console.error(err);
    }
  }

  static postNewApi = async(req: Request, res: Response, next: NextFunction) => {
    const metaRepo = getRepository(Meta);
    const columnRepo = getRepository(MetaColumn);
    const apiRepo = getRepository(Api);

    const { id } = req.params;
    const { tableName } = req.body;

    if(tableName == undefined) {
      console.error('no table name')
      res.redirect(`/metas`);
      return;
    }
    try {
      // meta data load
      const meta = await metaRepo.findOneOrFail({
        relations: ["api"],
        where: {
          id: id
        }
      })

      const metaColumns = await columnRepo.find({
        where: {
          meta: {
            id: id
          }
        },
        order: {
          order: 'ASC'
        }
      });

      if(meta.api || meta.isActive) {
        console.error(`api already exists`);
      }

      // column data 생성
      let columns = []
      let columnNames = []
      // autoincrease 설정
      columns.push({
        name: "id",
        type: "int",
        isPrimary: true,
        isGenerated: true,
        generationStrategy: "increment"
      })

      metaColumns.forEach(column => {
        columnNames.push(column.columnName)
        columns.push({
          name: column.columnName,
          type: column.type
        })
      });

      //table data 생성
      //table Name convention 필요

      let api = new Api();
      api.user = <User>req.user;
      api.meta = meta;
      api.title = tableName;
      api.tableName = `${api.user.id}_${tableName}`
      const tableOption: TableOptions = {
        name: api.tableName,
        columns: columns
      }
      
      let insertQuery = `INSERT INTO ${tableOption.name}(${columnNames.join(",")}) VALUES ?`
      console.log(insertQuery);
      let insertValues = []
      //xlsx read
      const loadedWorkbook = await new Excel.Workbook().xlsx.readFile(meta.filePath);
      const worksheet = loadedWorkbook.worksheets[1]
      const totalRowCount = worksheet.rowCount
      for(let i = 2; i <= totalRowCount; i++) {
        let row = <string[]>worksheet.getRow(i).values
        if(row.length == 0) continue;
        insertValues.push(row.slice(1));
      }

      await getManager().transaction("SERIALIZABLE", async transactionalEntityManager => {
        await getConnection().createQueryRunner().createTable(new Table(tableOption), true);
        console.log("create done")
        await getConnection().manager.query(insertQuery, [insertValues])
        console.log("insert done")
        await apiRepo.save(api);
        meta.isActive = true;
        await metaRepo.save(meta);
        console.log("meta done")
      });
      
      res.redirect(`/metas/${meta.id}`)
    } catch (err) {
      console.error(err);
    }
  }
}

export default MetaController;