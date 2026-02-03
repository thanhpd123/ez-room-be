const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const ClipVector = sequelize.define('ClipVector', {
        vector_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        type: {
            type: DataTypes.STRING(50),
            allowNull: false,
        },
        reference_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        embedding: {
            type: DataTypes.ARRAY(DataTypes.FLOAT),
            allowNull: false,
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
    }, {
        tableName: 'clip_vectors',
        timestamps: false,
    });

    return ClipVector;
};
